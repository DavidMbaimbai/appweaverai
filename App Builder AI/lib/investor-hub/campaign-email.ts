import { unsubscribeUrl } from '@/lib/outreach/compliance';

const escapeHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function campaignSender() {
  const address = process.env.OUTREACH_FROM_EMAIL?.trim() || 'david.mbaimbai@appweaverai.com';
  return { name: 'David Mbaimbai', address, from: `David Mbaimbai <${address}>` };
}

/** Sending needs SMTP plus the physical postal address that commercial email law requires. */
export function campaignEmailConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASSWORD &&
      process.env.OUTREACH_POSTAL_ADDRESS?.trim() &&
      (process.env.OUTREACH_SECRET?.trim() || process.env.CRON_SECRET?.trim()),
  );
}

/**
 * Every campaign email carries: sender identity, who it is sent on behalf of, a physical address,
 * why the recipient was contacted (public source) and a working one-click unsubscribe (link + headers).
 */
export function composeCampaignEmail(input: {
  body: string;
  to: string;
  sourceUrl: string;
  postalAddress: string;
  company: string;
}) {
  const link = unsubscribeUrl(input.to);
  const sender = campaignSender();
  const lines = [
    `${sender.name}, AppWeaver AI, on behalf of ${input.company}`,
    input.postalAddress,
    `You received this because your business contact details are publicly listed at ${input.sourceUrl}. Do not want to hear from us? Opt out here: ${link}`,
  ];
  const body = input.body.trim();
  const text = `${body}\n\n--\n${lines.join('\n')}`;
  const html = `<div style="font-family:sans-serif;white-space:pre-wrap;">${escapeHtml(body)}</div><hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px"><div style="font-family:sans-serif;font-size:12px;color:#666;">${escapeHtml(lines[0])}<br>${escapeHtml(lines[1])}<br>You received this because your business contact details are publicly listed at ${escapeHtml(input.sourceUrl)}. <a href="${link}">Opt out</a></div>`;
  return {
    text,
    html,
    link,
    headers: {
      'List-Unsubscribe': `<${link}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    } as Record<string, string>,
  };
}
