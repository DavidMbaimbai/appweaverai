import { unzipSync, strFromU8 } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/privacy/storage', () => ({
  privacyStorageConfigured: () => false,
  putPrivateObject: vi.fn(),
  getPrivateObject: vi.fn(),
  deleteObjects: vi.fn(),
}));

import { GET as cron } from '@/app/api/cron/privacy/route';
import { getSuppression } from '@/lib/messaging/consent';
import { listSubjectConsents, withdrawConsent } from '@/lib/privacy/consents';
import { EXPORT_DAILY_LIMIT, loadExportBytes, requestUserExport, runExportJob } from '@/lib/privacy/export';
import { hashEmail } from '@/lib/privacy/identifiers';
import { completeRequest, eraseForRequest, exportForRequest, searchForRequest, submitRequest, verifyRequest } from '@/lib/privacy/requests';
import { runRetention, savePolicy } from '@/lib/privacy/retention';
import { findSubject } from '@/lib/privacy/subject';
import { findOutreachSuppression } from '@/lib/privacy/suppression';
import { cancelAccountDeletion, eraseUserAccount, processDueDeletions, requestAccountDeletion, type ErasureDeps } from '@/lib/privacy/user-erasure';

import { makeProjectFor, makeUser, prisma, sql, uid } from './db';

const deps = (): ErasureDeps & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    cancelSubscription: vi.fn(async (id: string) => void calls.push(`cancel:${id}`)),
    scrubBillingCustomer: vi.fn(async (id: string) => void calls.push(`scrub:${id}`)),
    revokeCalendarToken: vi.fn(async () => undefined),
    deleteObjects: vi.fn(async (keys: string[]) => void calls.push(`delete:${keys.join(',')}`)),
    deleteProjectWorkspaces: vi.fn(async (ids: string[]) => void calls.push(`workspaces:${ids.join(',')}`)),
  };
};

/** Every row in every table whose text/json columns contain `needle`. */
async function tablesContaining(needle: string) {
  const columns = await sql<{ table_name: string; column_name: string }>(
    `SELECT c.table_name, c.column_name FROM information_schema.columns c
     JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.table_name <> '_prisma_migrations'
       AND c.data_type IN ('text', 'character varying', 'jsonb', 'json', 'ARRAY')`,
  );
  const hits: string[] = [];
  for (const { table_name, column_name } of columns.rows) {
    const found = await sql(`SELECT 1 FROM "${table_name}" WHERE "${column_name}"::text ILIKE $1 LIMIT 1`, [`%${needle}%`]);
    if (found.rowCount) hits.push(`${table_name}.${column_name}`);
  }
  return hits;
}

async function seedCustomer(email: string) {
  const user = await makeUser({ email });
  const { project, workspace } = await makeProjectFor(user);
  await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: `cus_${user.id}`, stripeSubscriptionId: `sub_${user.id}` } });
  const lead = await prisma.lead.create({ data: { projectId: project.id, name: `Lead of ${user.id}`, email: `lead-${user.id}@leads.test`, optedOut: true } });
  const investor = await prisma.hubInvestor.create({ data: { userId: user.id, projectId: project.id, name: 'Inv', email: `inv-${user.id}@vc.test`, emailKey: `inv-${user.id}@vc.test` } });
  await prisma.creditLedger.create({ data: { userId: user.id, delta: 100, reason: 'Top up', operation: 'topup', balanceAfter: 100, idempotencyKey: uid('idem') } });
  await prisma.marketingPurchase.create({ data: { userId: user.id, packageName: 'Pack', credits: 10, amountCents: 1000, currency: 'usd', stripeSessionId: uid('cs') } });
  await prisma.outreachSuppression.create({ data: { email: `lead-${user.id}@leads.test`, reason: 'OPT_OUT' } });
  await prisma.messagingSuppression.create({ data: { scopeType: 'PROJECT', scopeId: project.id, channel: 'EMAIL', contact: `lead-${user.id}@leads.test`, reason: 'UNSUBSCRIBE', source: 'test' } });
  await prisma.conversation.create({ data: { scopeType: 'PROJECT', scopeId: project.id, channel: 'EMAIL', externalThreadId: uid('t'), contactRef: `lead-${user.id}@leads.test`, messages: { create: { channel: 'EMAIL', direction: 'INBOUND', body: 'hello' } } } });
  return { user, project, workspace, lead, investor };
}

beforeEach(() => vi.clearAllMocks());

describe('account export', () => {
  it('contains only the requesting user data, and is rate limited', async () => {
    const a = await seedCustomer('alice@privacy.test');
    const b = await seedCustomer('bob@privacy.test');

    const queued = await requestUserExport(a.user.id);
    expect(queued).toMatchObject({ ok: true, reused: false });
    if (!queued.ok) return;
    expect((await requestUserExport(a.user.id))).toMatchObject({ ok: true, reused: true });
    expect(await runExportJob(queued.jobId)).toMatchObject({ ran: true, ok: true });
    expect(await runExportJob(queued.jobId)).toEqual({ ran: false });

    const job = await prisma.privacyExportJob.findUniqueOrThrow({ where: { id: queued.jobId } });
    expect(job.status).toBe('READY');
    const files = unzipSync(new Uint8Array((await loadExportBytes(job))!));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['README.txt', 'manifest.json', 'export.json', 'data/leads.json']));
    const text = strFromU8(files['export.json']);
    expect(text).toContain('alice@privacy.test');
    expect(text).toContain(`lead-${a.user.id}@leads.test`);
    expect(text).not.toContain('bob@privacy.test');
    expect(text).not.toContain(b.user.id);
    expect(text).not.toContain(b.project.id);
    expect(text).not.toMatch(/passwordHash|refreshToken/i);

    await prisma.privacyExportJob.updateMany({ data: { status: 'EXPIRED' } });
    for (let i = 1; i < EXPORT_DAILY_LIMIT; i += 1) {
      expect((await requestUserExport(a.user.id)).ok).toBe(true);
      await prisma.privacyExportJob.updateMany({ data: { status: 'EXPIRED' } });
    }
    expect(await requestUserExport(a.user.id)).toMatchObject({ ok: false });
  });
});

describe('account deletion', () => {
  it('waits out the grace period, can be cancelled, and is idempotent', async () => {
    const a = await seedCustomer('carol@privacy.test');
    const now = new Date();
    const first = await requestAccountDeletion(a.user.id, { now });
    expect(first).toMatchObject({ ok: true, alreadyScheduled: false });
    expect(await requestAccountDeletion(a.user.id, { now })).toMatchObject({ ok: true, alreadyScheduled: true });

    const d = deps();
    expect(await processDueDeletions(now, d)).toEqual([]);
    expect(await cancelAccountDeletion(a.user.id)).toBe(true);
    expect(await processDueDeletions(new Date(now.getTime() + 60 * 86_400_000), d)).toEqual([]);
    expect(await prisma.project.count({ where: { id: a.project.id } })).toBe(1);

    await requestAccountDeletion(a.user.id, { now });
    const later = new Date(now.getTime() + 15 * 86_400_000);
    expect(await processDueDeletions(later, d)).toEqual([{ userId: a.user.id, ok: true }]);
    expect(await processDueDeletions(later, d)).toEqual([]);
    expect((await prisma.privacyDeletionRequest.findUniqueOrThrow({ where: { userId: a.user.id } })).status).toBe('COMPLETED');
    expect((await requestAccountDeletion(a.user.id)).ok).toBe(false);
  });

  it('refuses platform administrators', async () => {
    const admin = await makeUser({ adminRole: 'ADMIN' });
    expect((await requestAccountDeletion(admin.id)).ok).toBe(false);
  });

  it('erases PII, keeps billing and hashed opt-outs, and leaves other users untouched', async () => {
    const a = await seedCustomer('dave@privacy.test');
    const b = await seedCustomer('erin@privacy.test');
    const d = deps();

    expect(await eraseUserAccount(a.user.id, d)).toEqual({ erased: true });
    expect(d.calls).toContain(`cancel:sub_${a.user.id}`);
    expect(d.calls).toContain(`scrub:cus_${a.user.id}`);
    expect(d.calls).toContain(`workspaces:${a.project.id}`);

    const erased = await prisma.user.findUniqueOrThrow({ where: { id: a.user.id } });
    expect(erased.email).toMatch(/@erased\.invalid$/);
    expect(erased.accountStatus).toBe('DISABLED');
    expect(await prisma.project.count({ where: { id: a.project.id } })).toBe(0);
    expect(await prisma.lead.count({ where: { id: a.lead.id } })).toBe(0);
    expect(await prisma.hubInvestor.count({ where: { id: a.investor.id } })).toBe(0);
    expect(await prisma.conversation.count({ where: { scopeId: a.project.id } })).toBe(0);

    // Billing integrity.
    expect(await prisma.creditLedger.count({ where: { userId: a.user.id } })).toBe(1);
    expect(await prisma.marketingPurchase.count({ where: { userId: a.user.id } })).toBe(1);

    // No PII anywhere.
    for (const needle of ['dave@privacy.test', `lead-${a.user.id}@leads.test`, `inv-${a.user.id}@vc.test`]) {
      expect(await tablesContaining(needle)).toEqual([]);
    }

    // Opt-outs survive as hashes.
    const leadEmail = `lead-${a.user.id}@leads.test`;
    expect(await prisma.outreachSuppression.findUnique({ where: { email: leadEmail } })).toBeNull();
    expect(await findOutreachSuppression(leadEmail)).toMatchObject({ reason: 'OPT_OUT' });
    expect(await findOutreachSuppression(leadEmail.toUpperCase())).not.toBeNull();
    expect(await prisma.outreachSuppression.findUnique({ where: { email: hashEmail(leadEmail) } })).not.toBeNull();
    expect(await getSuppression({ type: 'PROJECT', projectId: a.project.id }, 'EMAIL', leadEmail)).not.toBeNull();

    // Idempotent, and nobody else was touched.
    expect(await eraseUserAccount(a.user.id, deps())).toEqual({ erased: true });
    expect(await prisma.creditLedger.count({ where: { userId: a.user.id } })).toBe(1);
    expect(await prisma.project.count({ where: { id: b.project.id } })).toBe(1);
    expect(await prisma.lead.count({ where: { id: b.lead.id } })).toBe(1);
    expect(await prisma.hubInvestor.count({ where: { id: b.investor.id } })).toBe(1);
    expect(await prisma.conversation.count({ where: { scopeId: b.project.id } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: b.user.id } })).email).toBe('erin@privacy.test');
    expect(await prisma.outreachSuppression.findUnique({ where: { email: `lead-${b.user.id}@leads.test` } })).not.toBeNull();
  });
});

describe('data-subject requests', () => {
  it('verifies the email, starts the 30-day clock, searches, exports, erases and closes', async () => {
    const admin = await makeUser({ adminRole: 'ADMIN' });
    const actor = { id: admin.id, email: admin.email };
    const owner = await seedCustomer('frank@privacy.test');
    const other = await prisma.lead.create({ data: { projectId: owner.project.id, name: 'Someone Else', email: 'someone.else@leads.test' } });
    const subject = await prisma.lead.create({ data: { projectId: owner.project.id, name: 'Jane Subject', email: 'Jane.Subject@Leads.test', phone: '+27 82 555 0101', optedOut: true } });
    await prisma.consentProof.create({ data: { scopeType: 'PROJECT', scopeId: owner.project.id, channel: 'EMAIL', contact: 'jane.subject@leads.test', source: 'form', proof: 'ticked box', capturedAt: new Date() } });
    await prisma.outreachSuppression.create({ data: { email: 'jane.subject@leads.test', reason: 'OPT_OUT' } });

    const intake = await submitRequest({ type: 'ERASURE', name: 'Jane', email: 'jane.subject@leads.test', ip: '1.2.3.4' });
    expect(intake.ok).toBe(true);
    if (!intake.ok) return;
    await expect(searchForRequest(intake.id, actor)).rejects.toThrow(/not verified/);

    const now = new Date();
    const verified = await verifyRequest(intake.token, now);
    expect(verified).toMatchObject({ ok: true, alreadyVerified: false });
    if (!verified.ok) return;
    expect(Math.round((verified.dueAt.getTime() - now.getTime()) / 86_400_000)).toBe(30);
    expect(await verifyRequest(intake.token)).toMatchObject({ ok: true, alreadyVerified: true });
    expect((await verifyRequest('bogus')).ok).toBe(false);

    const search = await searchForRequest(intake.id, actor);
    expect(search.matches.leads).toEqual([subject.id]);
    expect(search.matches.consentProofs).toHaveLength(1);

    const exported = JSON.stringify(await exportForRequest(intake.id, actor));
    expect(exported).toContain('Jane Subject');
    expect(exported).not.toContain('Someone Else');
    expect(exported).not.toContain('frank@privacy.test');

    const consents = await listSubjectConsents(search.matches);
    expect(consents.some((c) => c.kind === 'LEAD')).toBe(true);

    await eraseForRequest(intake.id, actor, { suppressFuture: true, deps: deps() });
    await eraseForRequest(intake.id, actor, { suppressFuture: true, deps: deps() });
    expect(await prisma.lead.count({ where: { id: subject.id } })).toBe(0);
    expect(await prisma.lead.count({ where: { id: other.id } })).toBe(1);
    expect(await findSubject({ email: 'jane.subject@leads.test' })).toMatchObject({ leads: [], consentProofs: [] });
    expect(await findOutreachSuppression('jane.subject@leads.test')).not.toBeNull();

    expect(await completeRequest(intake.id, actor, 'FULFILLED', 'Erased everything held')).toMatchObject({ ok: true });
    expect(await completeRequest(intake.id, actor, 'FULFILLED', 'again')).toMatchObject({ ok: true, alreadyClosed: true });
    const closed = await prisma.privacyRequest.findUniqueOrThrow({ where: { id: intake.id } });
    expect(closed).toMatchObject({ status: 'COMPLETED', outcome: 'FULFILLED', email: null, phone: null, requesterName: null });
    expect(closed.emailHash).toBeTruthy();

    for (const needle of ['jane.subject@leads.test', 'Jane Subject', '555 0101', '8255550101']) {
      expect(await tablesContaining(needle)).toEqual([]);
    }
    const events = await prisma.privacyRequestEvent.findMany({ where: { requestId: intake.id } });
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(['SUBMITTED', 'VERIFIED', 'SEARCHED', 'EXPORTED', 'ERASED', 'COMPLETED']));
    expect(await prisma.adminAuditLog.count({ where: { action: 'privacy.request.erased', targetId: intake.id } })).toBeGreaterThan(0);
  });

  it('finds a subject by phone number across formats', async () => {
    const owner = await seedCustomer('gina@privacy.test');
    await prisma.lead.create({ data: { projectId: owner.project.id, name: 'Phone Lead', phone: '(082) 555-0102' } });
    await prisma.lead.create({ data: { projectId: owner.project.id, name: 'Phone Lead 2', phone: '082 555 0102' } });
    expect((await findSubject({ phone: '0825550102' })).leads).toHaveLength(2);
  });
});

describe('consent management', () => {
  it('withdrawing a consent suppresses the contact', async () => {
    const owner = await seedCustomer('hank@privacy.test');
    await prisma.contactConsent.create({ data: { scopeType: 'PROJECT', scopeId: owner.project.id, channel: 'EMAIL', contact: 'optin@leads.test', optIn: true, source: 'form' } });
    const matches = await findSubject({ email: 'optin@leads.test' });
    const [entry] = (await listSubjectConsents(matches)).filter((c) => c.kind === 'CONTACT');
    expect(entry).toMatchObject({ granted: true, canWithdraw: true });
    expect(await withdrawConsent(entry.key)).toMatchObject({ ok: true });
    expect(await withdrawConsent(entry.key)).toMatchObject({ ok: true });
    expect(await getSuppression({ type: 'PROJECT', projectId: owner.project.id }, 'EMAIL', 'optin@leads.test')).not.toBeNull();
    expect((await withdrawConsent('SUPPRESSION:x')).ok).toBe(false);
  });
});

describe('retention', () => {
  const old = new Date(Date.now() - 800 * 86_400_000);

  async function seed() {
    const owner = await seedCustomer('ivy@privacy.test');
    const oldLost = await prisma.lead.create({ data: { projectId: owner.project.id, name: 'Old lost', status: 'LOST' } });
    const recentLost = await prisma.lead.create({ data: { projectId: owner.project.id, name: 'Recent lost', status: 'LOST' } });
    const oldWon = await prisma.lead.create({ data: { projectId: owner.project.id, name: 'Old won', status: 'WON' } });
    await sql('UPDATE leads SET updated_at = $1 WHERE id = ANY($2)', [old, [oldLost.id, oldWon.id]]);
    const stale = await prisma.conversation.create({ data: { scopeType: 'PROJECT', scopeId: owner.project.id, channel: 'EMAIL', externalThreadId: uid('t'), contactRef: 'x@y.test', messages: { create: [{ channel: 'EMAIL', direction: 'INBOUND', body: 'old' }, { channel: 'EMAIL', direction: 'OUTBOUND', body: 'old2' }] } } });
    await sql('UPDATE inbox_messages SET created_at = $1 WHERE conversation_id = $2', [old, stale.id]);
    return { owner, oldLost, recentLost, oldWon, stale };
  }

  it('does nothing while policies are disabled, counts in dry run, purges for real, and is idempotent', async () => {
    const s = await seed();
    expect(await runRetention()).toEqual([]);

    await savePolicy('lost_leads', { retentionDays: 365, enabled: true, dryRun: true }, null);
    await savePolicy('messages', { retentionDays: 365, enabled: true, dryRun: true }, null);
    const dry = await runRetention();
    expect(dry.find((r) => r.key === 'lost_leads')).toMatchObject({ dryRun: true, count: 1 });
    expect(dry.find((r) => r.key === 'messages')).toMatchObject({ dryRun: true, count: 2 });
    expect(await prisma.lead.count({ where: { id: s.oldLost.id } })).toBe(1);
    expect(await prisma.inboxMessage.count({ where: { conversationId: s.stale.id } })).toBe(2);
    expect(await prisma.adminAuditLog.count({ where: { action: 'privacy.retention.dry_run' } })).toBe(2);

    await savePolicy('lost_leads', { retentionDays: 365, enabled: true, dryRun: false }, null);
    await savePolicy('messages', { retentionDays: 365, enabled: true, dryRun: false }, null);
    const real = await runRetention();
    expect(real.find((r) => r.key === 'lost_leads')).toMatchObject({ dryRun: false, count: 1 });
    expect(await prisma.lead.count({ where: { id: s.oldLost.id } })).toBe(0);
    expect(await prisma.lead.count({ where: { id: { in: [s.recentLost.id, s.oldWon.id] } } })).toBe(2);
    expect(await prisma.inboxMessage.count({ where: { conversationId: s.stale.id } })).toBe(0);
    expect(await prisma.conversation.count({ where: { id: s.stale.id } })).toBe(1);
    expect(await prisma.adminAuditLog.count({ where: { action: 'privacy.retention.purge' } })).toBe(2);
    expect((await runRetention()).every((r) => r.count === 0)).toBe(true);

    expect(await savePolicy('lost_leads', { retentionDays: 3, enabled: true, dryRun: false }, null)).toMatchObject({ ok: false });
  });

  it('keeps an opted-out lead as a hashed suppression when it is purged', async () => {
    const owner = await seedCustomer('jack@privacy.test');
    const lead = await prisma.lead.create({ data: { projectId: owner.project.id, name: 'Gone', email: 'gone@leads.test', status: 'LOST', optedOut: true } });
    await prisma.outreachSuppression.create({ data: { email: 'gone@leads.test', reason: 'OPT_OUT' } });
    await sql('UPDATE leads SET updated_at = $1 WHERE id = $2', [old, lead.id]);
    await savePolicy('lost_leads', { retentionDays: 365, enabled: true, dryRun: false }, null);
    await runRetention({ only: 'lost_leads' });
    expect(await prisma.lead.count({ where: { id: lead.id } })).toBe(0);
    expect(await prisma.outreachSuppression.findUnique({ where: { email: 'gone@leads.test' } })).toBeNull();
    expect(await findOutreachSuppression('gone@leads.test')).not.toBeNull();
  });

  it('is driven by the cron route, which requires the bearer secret', async () => {
    const s = await seed();
    await savePolicy('lost_leads', { retentionDays: 365, enabled: true, dryRun: false }, null);
    expect((await cron(new Request('http://localhost/api/cron/privacy'))).status).toBe(401);
    const res = await cron(new Request('http://localhost/api/cron/privacy', { headers: { authorization: 'Bearer integration-cron-secret' } }));
    expect(res.status).toBe(200);
    expect(await prisma.lead.count({ where: { id: s.oldLost.id } })).toBe(0);
  });
});
