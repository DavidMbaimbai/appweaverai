// Queues today's generated demo video as a social post that publishes at midnight.
//   VIDEO_URL=https://... node scripts/queue-demo-post.mjs
// Env: DEMO_BASE_URL, CRON_SECRET, VIDEO_URL, optional PUBLISH_AT_UTC_HOUR (default 22 = 00:00 UTC+2)
import { readFileSync } from 'node:fs';

const base = (process.env.DEMO_BASE_URL || '').replace(/\/$/, '');
const secret = process.env.CRON_SECRET;
const videoUrl = process.env.VIDEO_URL;
if (!base || !secret || !videoUrl) {
  console.error('DEMO_BASE_URL, CRON_SECRET and VIDEO_URL are required.');
  process.exit(1);
}

const meta = JSON.parse(readFileSync('videos/meta.json', 'utf8'));
if (!(meta.durationSeconds > 0 && meta.durationSeconds <= 180)) {
  console.error(`Refusing to queue: video length ${meta.durationSeconds}s is not within 3 minutes.`);
  process.exit(1);
}

const posts = [
  ['From idea to full-stack app in minutes', 'Describe your app in plain English and AppWeaver AI writes the code, runs a live preview and lets you export it. Watch the walkthrough from signup to checkout.'],
  ['Build a real app by just typing', 'Java, Python, Node or Go backend plus a browser frontend, generated from one prompt. See how it works.'],
  ['No code? No problem.', 'AppWeaver AI turns your prompt into working code you own. Preview it live, keep chatting to refine it, then ship.'],
  ['Prompt. Preview. Publish.', 'See the whole AppWeaver AI flow in under three minutes: sign up, write a prompt, review the code and preview your app.'],
  ['Your idea, built by AI', 'Watch our AI presenter walk through building an app end to end with AppWeaver AI. Start free today.'],
];
const [title, message] = posts[Math.floor(Date.now() / 86_400_000) % posts.length];

const hour = Number(process.env.PUBLISH_AT_UTC_HOUR ?? 22);
const when = new Date();
when.setUTCHours(hour, 0, 0, 0);
if (when.getTime() < Date.now() + 5 * 60_000) when.setUTCDate(when.getUTCDate() + 1);

const response = await fetch(`${base}/api/social/posts`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
  body: JSON.stringify({
    title,
    message: `${message}\n\nhttps://appweaverai.com`,
    videoUrl,
    durationSeconds: meta.durationSeconds,
    scheduledFor: when.toISOString(),
  }),
});
console.log(response.status, await response.text());
if (!response.ok) process.exit(1);
