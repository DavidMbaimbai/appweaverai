import { sendEmail } from '@/lib/email';

const THROTTLE_MS = 10 * 60 * 1000;
const recent = new Map<string, number>();

/**
 * Sends an operational alert to ALERT_WEBHOOK_URL (Slack/Discord-compatible
 * `{ text }` JSON) and/or ALERT_EMAIL. Identical alerts are throttled per
 * instance so an outage can't flood the channel. Never throws.
 */
export async function sendAlert(subject: string, detail?: string) {
  const now = Date.now();
  const last = recent.get(subject);
  if (last && now - last < THROTTLE_MS) return;
  recent.set(subject, now);
  if (recent.size > 200) recent.clear();

  const text = detail ? `${subject}\n${detail.slice(0, 1500)}` : subject;
  const webhook = process.env.ALERT_WEBHOOK_URL?.trim();
  const email = process.env.ALERT_EMAIL?.trim();

  await Promise.allSettled([
    webhook
      ? fetch(webhook, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: `[AppWeaver] ${text}` }),
          signal: AbortSignal.timeout(5000),
        })
      : Promise.resolve(),
    email
      ? sendEmail({
          to: email,
          subject: `[AppWeaver alert] ${subject}`,
          text,
          html: `<pre style="font-family:monospace;white-space:pre-wrap;">${text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')}</pre>`,
        })
      : Promise.resolve(),
  ]);
}
