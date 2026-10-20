import { Prisma } from '@/lib/generated/prisma/client';
import { recordAuditLog } from '@/lib/admin/audit';
import { prisma } from '@/lib/prisma';

import { hashOutreachSuppressions } from './anonymise';

export type RetentionKey = 'messages' | 'call_logs' | 'transcripts' | 'meeting_notes' | 'lost_leads' | 'investor_contacts';

export type RetentionDefinition = {
  key: RetentionKey;
  label: string;
  description: string;
  defaultDays: number;
};

export const RETENTION_DEFINITIONS: RetentionDefinition[] = [
  { key: 'messages', label: 'Inbox messages', description: 'Messages in the unified inbox (whole conversations with no activity inside the window).', defaultDays: 730 },
  { key: 'call_logs', label: 'Call and SMS logs', description: 'Investor call log entries, SMS records and AI voice call records.', defaultDays: 730 },
  { key: 'transcripts', label: 'Transcripts', description: 'AI voice call transcripts and meeting transcripts (the record itself is kept).', defaultDays: 365 },
  { key: 'meeting_notes', label: 'Meeting notes', description: 'Internal meeting notes and summaries on finished meetings.', defaultDays: 365 },
  { key: 'lost_leads', label: 'Lost leads', description: 'Leads marked LOST with no activity inside the window.', defaultDays: 365 },
  { key: 'investor_contacts', label: 'Old investor contacts', description: 'Investor contacts that never progressed (discovered/researched/declined) and are untouched inside the window.', defaultDays: 1095 },
];

export const MIN_RETENTION_DAYS = 30;

export type EffectivePolicy = RetentionDefinition & {
  retentionDays: number;
  enabled: boolean;
  dryRun: boolean;
  lastRunAt: Date | null;
  lastRunCount: number | null;
};

export async function listRetentionPolicies(): Promise<EffectivePolicy[]> {
  const rows = await prisma.privacyRetentionPolicy.findMany();
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return RETENTION_DEFINITIONS.map((def) => {
    const row = byKey.get(def.key);
    return {
      ...def,
      retentionDays: row?.retentionDays ?? def.defaultDays,
      enabled: row?.enabled ?? false,
      dryRun: row?.dryRun ?? true,
      lastRunAt: row?.lastRunAt ?? null,
      lastRunCount: row?.lastRunCount ?? null,
    };
  });
}

export async function savePolicy(key: string, input: { retentionDays: number; enabled: boolean; dryRun: boolean }, updatedById: string | null) {
  if (!RETENTION_DEFINITIONS.some((def) => def.key === key)) return { ok: false as const, error: 'Unknown policy.' };
  if (!Number.isInteger(input.retentionDays) || input.retentionDays < MIN_RETENTION_DAYS) {
    return { ok: false as const, error: `Retention must be a whole number of at least ${MIN_RETENTION_DAYS} days.` };
  }
  await prisma.privacyRetentionPolicy.upsert({
    where: { key },
    create: { key, ...input, updatedById },
    update: { ...input, updatedById },
  });
  return { ok: true as const };
}

const cutoffFor = (days: number, now: Date) => new Date(now.getTime() - days * 86_400_000);

type Purger = (cutoff: Date, dryRun: boolean) => Promise<number>;

const NO_TRANSCRIPT = { equals: [] as never[] };

const purgers: Record<RetentionKey, Purger> = {
  async messages(cutoff, dryRun) {
    // Whole conversations whose newest message is older than the cutoff; the conversation row stays so contact/consent state is kept.
    const stale = await prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT conversation_id AS id FROM inbox_messages GROUP BY conversation_id HAVING MAX(created_at) < ${cutoff}`,
    );
    const ids = stale.map((row) => row.id);
    if (ids.length === 0) return 0;
    if (dryRun) return prisma.inboxMessage.count({ where: { conversationId: { in: ids } } });
    return (await prisma.inboxMessage.deleteMany({ where: { conversationId: { in: ids } } })).count;
  },
  async call_logs(cutoff, dryRun) {
    const calls = { createdAt: { lt: cutoff } };
    const voice = { createdAt: { lt: cutoff }, status: { notIn: ['QUEUED', 'IN_PROGRESS'] } };
    if (dryRun) {
      const [a, b, c] = await Promise.all([prisma.hubInvestorCall.count({ where: calls }), prisma.hubInvestorSms.count({ where: calls }), prisma.investorVoiceCall.count({ where: voice })]);
      return a + b + c;
    }
    const [a, b, c] = await Promise.all([prisma.hubInvestorCall.deleteMany({ where: calls }), prisma.hubInvestorSms.deleteMany({ where: calls }), prisma.investorVoiceCall.deleteMany({ where: voice })]);
    return a.count + b.count + c.count;
  },
  async transcripts(cutoff, dryRun) {
    const voiceWhere: Prisma.InvestorVoiceCallWhereInput = { createdAt: { lt: cutoff }, NOT: { transcript: NO_TRANSCRIPT } };
    const meetingWhere: Prisma.MeetingWhereInput = { createdAt: { lt: cutoff }, transcript: { not: null } };
    if (dryRun) {
      const [a, b] = await Promise.all([prisma.investorVoiceCall.count({ where: voiceWhere }), prisma.meeting.count({ where: meetingWhere })]);
      return a + b;
    }
    const [a, b] = await Promise.all([
      prisma.investorVoiceCall.updateMany({ where: voiceWhere, data: { transcript: [] } }),
      prisma.meeting.updateMany({ where: meetingWhere, data: { transcript: null } }),
    ]);
    return a.count + b.count;
  },
  async meeting_notes(cutoff, dryRun) {
    const where: Prisma.MeetingWhereInput = {
      OR: [{ endsAt: { lt: cutoff } }, { endsAt: null, createdAt: { lt: cutoff } }],
      AND: [{ OR: [{ internalNotes: { not: null } }, { summary: { not: null } }] }],
    };
    if (dryRun) return prisma.meeting.count({ where });
    return (await prisma.meeting.updateMany({ where, data: { internalNotes: null, summary: null, notesPurgedAt: new Date() } })).count;
  },
  async lost_leads(cutoff, dryRun) {
    const where: Prisma.LeadWhereInput = { status: 'LOST', updatedAt: { lt: cutoff } };
    if (dryRun) return prisma.lead.count({ where });
    // Keep opt-outs alive as hashes before the plain address disappears.
    const optedOut = await prisma.lead.findMany({ where: { ...where, optedOut: true, email: { not: null } }, select: { email: true } });
    await hashOutreachSuppressions(optedOut.flatMap((lead) => (lead.email ? [lead.email] : [])));
    return (await prisma.lead.deleteMany({ where })).count;
  },
  async investor_contacts(cutoff, dryRun) {
    const where: Prisma.HubInvestorWhereInput = { pipelineStage: { in: ['DISCOVERED', 'RESEARCHED', 'DECLINED'] }, updatedAt: { lt: cutoff } };
    if (dryRun) return prisma.hubInvestor.count({ where });
    const optedOut = await prisma.hubInvestor.findMany({ where: { ...where, email: { not: null } }, select: { email: true } });
    await hashOutreachSuppressions(optedOut.flatMap((investor) => (investor.email ? [investor.email] : [])));
    return (await prisma.hubInvestor.deleteMany({ where })).count;
  },
};

export type RetentionRunEntry = { key: RetentionKey; retentionDays: number; dryRun: boolean; count: number; cutoff: string };

export type RetentionRunOptions = {
  now?: Date;
  /** Run only this policy even if disabled (admin "run now"). */
  only?: RetentionKey;
  /** Overrides the stored dry-run flag (admin "run now"); the env force flag still wins. */
  dryRun?: boolean;
  /** Force dry-run for every policy. */
  forceDryRun?: boolean;
  actor?: { id: string; email: string | null } | null;
};

/** Applies the retention policies. Disabled policies are skipped unless named in `only`. Every non-empty run is audited. Idempotent: a second run finds nothing left. */
export async function runRetention(options: RetentionRunOptions = {}): Promise<RetentionRunEntry[]> {
  const now = options.now ?? new Date();
  const forceDryRun = options.forceDryRun || process.env.PRIVACY_RETENTION_FORCE_DRY_RUN === 'true';
  const policies = await listRetentionPolicies();
  const results: RetentionRunEntry[] = [];
  for (const policy of policies) {
    if (options.only ? policy.key !== options.only : !policy.enabled) continue;
    const dryRun = forceDryRun || (options.dryRun ?? policy.dryRun);
    const cutoff = cutoffFor(policy.retentionDays, now);
    const count = await purgers[policy.key](cutoff, dryRun);
    results.push({ key: policy.key, retentionDays: policy.retentionDays, dryRun, count, cutoff: cutoff.toISOString() });
    await prisma.privacyRetentionPolicy.upsert({
      where: { key: policy.key },
      create: { key: policy.key, retentionDays: policy.retentionDays, enabled: policy.enabled, dryRun: policy.dryRun, lastRunAt: now, lastRunCount: count },
      update: { lastRunAt: now, lastRunCount: count },
    });
    await recordAuditLog({
      adminId: options.actor?.id ?? null,
      adminEmail: options.actor?.email ?? 'system@retention',
      action: dryRun ? 'privacy.retention.dry_run' : 'privacy.retention.purge',
      targetType: 'RetentionPolicy',
      targetId: policy.key,
      after: { count, retentionDays: policy.retentionDays, cutoff: cutoff.toISOString() },
    });
  }
  return results;
}
