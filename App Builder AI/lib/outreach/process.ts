import { prisma } from '@/lib/prisma';
import { findOutreachSuppression } from '@/lib/privacy/suppression';
import { sendEmail } from '@/lib/email';
import {
  isValidEmail,
  normalizeEmail,
  unsubscribeUrl,
  withFooter,
} from '@/lib/outreach/compliance';
import {
  braveSearch,
  DEFAULT_QUERIES,
  draftOutreach,
  extractInvestors,
  fetchPageText,
  type ExtractedInvestor,
} from '@/lib/outreach/discover';

const MAX_PAGES_PER_QUERY = 5;
const MAX_DRAFTS_PER_RUN = 10;
const DAILY_SEND_LIMIT = Number(process.env.OUTREACH_DAILY_LIMIT ?? 20);

export const OUTREACH_FROM = process.env.OUTREACH_FROM_EMAIL?.trim() || 'david.mbaimbai@appweaverai.com';

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

export async function suppress(email: string, reason: string) {
  const address = normalizeEmail(email);
  await prisma.outreachSuppression.upsert({
    where: { email: address },
    create: { email: address, reason },
    update: {},
  });
  await prisma.investorLead.updateMany({
    where: { email: address, status: { not: 'SENT' } },
    data: { status: 'DO_NOT_CONTACT', note: reason },
  });
}

export type DiscoverResult = { found: number; drafted: number; errors: string[] };

const CONTACT_PATHS = ['/team', '/contact'];

/**
 * Team/listicle pages often name investors without contacts. For investors still
 * missing an email or phone, look at the same site's team and contact pages and
 * fill in only details published there for the same person.
 */
async function enrichFromContactPages(
  pageUrl: string,
  investors: ExtractedInvestor[],
  visited: Set<string>,
) {
  if (!investors.some((i) => !i.email)) return investors;
  const origin = new URL(pageUrl).origin;
  if (visited.has(origin)) return investors;
  visited.add(origin);

  const byName = new Map(investors.map((i) => [i.name.toLowerCase(), i]));
  for (const path of CONTACT_PATHS) {
    const url = `${origin}${path}`;
    if (url === pageUrl) continue;
    const text = await fetchPageText(url);
    if (!text) continue;
    const found = await extractInvestors(url, text).catch(() => []);
    for (const candidate of found) {
      const target = byName.get(candidate.name.toLowerCase());
      if (!target) continue;
      target.email ??= candidate.email;
      target.phone ??= candidate.phone;
    }
  }
  return investors;
}

/** Searches the web for investors, stores new leads and drafts emails for review. Nothing is sent. */
export async function discoverInvestors(queries?: string[]): Promise<DiscoverResult> {
  const result: DiscoverResult = { found: 0, drafted: 0, errors: [] };
  const seenUrls = new Set<string>();
  const enrichedOrigins = new Set<string>();

  for (const query of queries?.length ? queries : DEFAULT_QUERIES) {
    let hits;
    try {
      hits = await braveSearch(query);
    } catch (error) {
      result.errors.push(String(error));
      continue;
    }

    for (const hit of hits.slice(0, MAX_PAGES_PER_QUERY)) {
      if (seenUrls.has(hit.url)) continue;
      seenUrls.add(hit.url);

      const pageText = await fetchPageText(hit.url);
      if (!pageText) continue;
      const extracted = await extractInvestors(hit.url, pageText).catch((error) => {
        result.errors.push(`${hit.url}: ${String(error).slice(0, 120)}`);
        return [];
      });
      const investors = await enrichFromContactPages(hit.url, extracted, enrichedOrigins);

      for (const investor of investors) {
        if (investor.email) {
          const blocked = await findOutreachSuppression(investor.email);
          if (blocked) continue;
        }
        try {
          await prisma.investorLead.create({
            data: {
              name: investor.name,
              firm: investor.firm,
              focus: investor.focus,
              email: investor.email,
              phone: investor.phone,
              sourceUrl: hit.url,
            },
          });
          result.found += 1;
        } catch {
          // Duplicate (same source+name or same email): already known.
        }
      }
    }
  }

  await draftPendingLeads(result);
  return result;
}

/** Drafts emails (and call talking points) for leads that don't have a draft yet. */
export async function draftPendingLeads(result: { drafted: number; errors: string[] }) {
  const leads = await prisma.investorLead.findMany({
    where: { status: 'DISCOVERED', body: null },
    orderBy: { createdAt: 'asc' },
    take: MAX_DRAFTS_PER_RUN,
  });
  for (const lead of leads) {
    try {
      const draft = await draftOutreach(lead);
      await prisma.investorLead.update({
        where: { id: lead.id },
        data: {
          subject: draft.subject,
          body: draft.body,
          talkingPoints: draft.talkingPoints,
          // Leads without a published email stay DISCOVERED and serve as a call list.
          ...(lead.email ? { status: 'PENDING_APPROVAL' as const } : {}),
        },
      });
      result.drafted += 1;
    } catch (error) {
      result.errors.push(`draft ${lead.id}: ${String(error).slice(0, 120)}`);
    }
  }
}

export type ImportedLead = {
  name: string;
  firm?: string;
  focus?: string;
  email?: string;
  phone?: string;
  sourceUrl?: string;
};

/** Adds leads from a list the user supplies (e.g. a CSV) and drafts their emails. */
export async function importLeads(leads: ImportedLead[]) {
  const result = { added: 0, skipped: 0, drafted: 0, errors: [] as string[] };
  for (const lead of leads) {
    const email = lead.email ? normalizeEmail(lead.email) : null;
    if (
      (email && !isValidEmail(email)) ||
      (email && (await findOutreachSuppression(email)))
    ) {
      result.skipped += 1;
      continue;
    }
    try {
      await prisma.investorLead.create({
        data: {
          name: lead.name,
          firm: lead.firm,
          focus: lead.focus,
          email,
          phone: lead.phone,
          sourceUrl: lead.sourceUrl || 'import',
        },
      });
      result.added += 1;
    } catch {
      result.skipped += 1;
    }
  }
  await draftPendingLeads(result);
  return result;
}

export type LeadReview =
  | { action: 'approve'; subject?: string; body?: string }
  | { action: 'reject' }
  | { action: 'do-not-contact' };

type ReviewError =
  | 'not-reviewable'
  | 'not-configured'
  | 'suppressed'
  | 'daily-limit'
  | 'no-email'
  | 'send-failed';

export async function reviewLead(
  id: string,
  review: LeadReview,
): Promise<{ ok: true } | { ok: false; error: ReviewError }> {
  if (review.action === 'reject') {
    const { count } = await prisma.investorLead.updateMany({
      where: { id, status: { in: ['DISCOVERED', 'PENDING_APPROVAL'] } },
      data: { status: 'REJECTED' },
    });
    return count ? { ok: true } : { ok: false, error: 'not-reviewable' };
  }

  if (review.action === 'do-not-contact') {
    const lead = await prisma.investorLead.findUnique({ where: { id } });
    if (!lead) return { ok: false, error: 'not-reviewable' };
    if (lead.email) await suppress(lead.email, 'marked do-not-contact');
    await prisma.investorLead.update({
      where: { id },
      data: { status: 'DO_NOT_CONTACT' },
    });
    return { ok: true };
  }

  const postalAddress = process.env.OUTREACH_POSTAL_ADDRESS?.trim();
  if (!postalAddress || !smtpConfigured()) return { ok: false, error: 'not-configured' };

  const sentToday = await prisma.investorLead.count({
    where: { status: 'SENT', sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  if (sentToday >= DAILY_SEND_LIMIT) return { ok: false, error: 'daily-limit' };

  // Claim first so a double-click can't send twice.
  const claimed = await prisma.investorLead.updateMany({
    where: { id, status: 'PENDING_APPROVAL' },
    data: { status: 'SENDING' },
  });
  if (!claimed.count) return { ok: false, error: 'not-reviewable' };

  const lead = await prisma.investorLead.findUniqueOrThrow({ where: { id } });
  const release = (note: string) =>
    prisma.investorLead.update({ where: { id }, data: { status: 'PENDING_APPROVAL', note } });

  // Re-check after claiming: concurrent approvals can all pass the early check.
  const inFlightOrSent = await prisma.investorLead.count({
    where: {
      id: { not: id },
      OR: [
        { status: 'SENT', sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        { status: 'SENDING' },
      ],
    },
  });
  if (inFlightOrSent >= DAILY_SEND_LIMIT) {
    await release('daily send limit reached');
    return { ok: false, error: 'daily-limit' };
  }

  const subject = (review.subject ?? lead.subject)?.trim();
  const body = (review.body ?? lead.body)?.trim();
  if (!lead.email || !isValidEmail(lead.email) || !subject || !body) {
    await release('missing email, subject or body');
    return { ok: false, error: 'no-email' };
  }

  if (await findOutreachSuppression(normalizeEmail(lead.email))) {
    await prisma.investorLead.update({ where: { id }, data: { status: 'DO_NOT_CONTACT' } });
    return { ok: false, error: 'suppressed' };
  }

  const footer = withFooter({ body, email: lead.email, postalAddress });
  try {
    await sendEmail({
      to: lead.email,
      from: `David Mbaimbai <${OUTREACH_FROM}>`,
      subject,
      text: footer.text,
      html: footer.html,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl(lead.email)}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
  } catch (error) {
    await release(`send failed: ${String(error).slice(0, 300)}`);
    return { ok: false, error: 'send-failed' };
  }

  await prisma.investorLead.update({
    where: { id },
    data: { status: 'SENT', sentAt: new Date(), subject, body, note: null },
  });
  return { ok: true };
}
