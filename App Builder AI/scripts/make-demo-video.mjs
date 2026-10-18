// Fully automated product video: an AI-generated presenter (animated avatar + synthetic
// voice, no paid API) narrates a real user-side walkthrough - prompt, sign-up, code,
// preview and checkout. Admin pages, real emails/OTP codes and keys are never shown.
//   1. app running locally (npm run dev -- -p 3000) with DB, ANTHROPIC key, Stripe TEST keys
//   2. node scripts/make-demo-video.mjs   -> videos/appweaver-demo.mp4 + videos/meta.json (<= 3 min)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { chromium } from '@playwright/test';
import ffmpegPath from 'ffmpeg-static';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import pg from 'pg';

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const BASE = process.env.DEMO_BASE_URL || 'http://localhost:3000';
const MAX_SECONDS = 180;
const OUT = 'videos';
const RAW = path.join(OUT, '.raw');
const PROMPT = process.env.DEMO_PROMPT || 'Build a task manager with user login, projects and a REST API';
const VOICE = process.env.DEMO_VOICE || 'en-US-AriaNeural';
const DISCOVER = process.env.DEMO_DISCOVER === '1';
const email = `demo-${Date.now()}@demo.appweaverai.invalid`;
const password = `Demo-${Math.random().toString(36).slice(2)}-Aa1!`;

rmSync(RAW, { recursive: true, force: true });
mkdirSync(RAW, { recursive: true });

// The presenter looks different each day (seeded by date) - created by the system.
const day = Math.floor(Date.now() / 86_400_000);
const pick = (list, salt) => list[(day * 7 + salt) % list.length];
const avatar = {
  skin: pick(['#f1c9a5', '#d9a47a', '#a87550', '#7a513a', '#f6d8bd'], 1),
  hair: pick(['#2b1b12', '#6b3a1e', '#111111', '#b5651d', '#4a4a4a'], 2),
  shirt: pick(['#fd5402', '#2563eb', '#16a34a', '#7c3aed', '#0f766e'], 3),
  long: day % 2 === 0,
};

function ffmpeg(args) {
  const result = spawnSync(ffmpegPath, ['-y', '-hide_banner', ...args], { encoding: 'utf8' });
  return result;
}

function mediaSeconds(file) {
  const out = ffmpeg(['-i', file]).stderr;
  const m = out.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

// Narration is cached by text+voice so reruns don't hammer the free TTS endpoint (429s).
async function synthesize(text, index) {
  const key = createHash('sha1').update(`${VOICE}|${text}`).digest('hex').slice(0, 16);
  const cacheDir = path.join(OUT, '.tts-cache');
  const cached = path.join(cacheDir, `${key}.mp3`);
  mkdirSync(cacheDir, { recursive: true });
  if (existsSync(cached)) return { file: cached, seconds: mediaSeconds(cached) };

  const dir = path.join(RAW, `tts-${index}`);
  mkdirSync(dir, { recursive: true });
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioFilePath } = await tts.toFile(dir, text);
      tts.close?.();
      copyFileSync(audioFilePath, cached);
      return { file: cached, seconds: mediaSeconds(cached) };
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function readOtp() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (let i = 0; i < 40; i++) {
      const { rows } = await client.query(
        'select value from verifications where identifier like $1 order by created_at desc limit 1',
        [`%${email}%`],
      );
      if (rows[0]) return rows[0].value.split(':')[0];
      await new Promise((r) => setTimeout(r, 1000));
    }
  } finally {
    await client.end();
  }
  throw new Error('OTP not found');
}

async function cleanup() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('delete from users where email = $1', [email]).catch(() => {});
  await client.end();
}

const NARRATION = {
  intro: 'Hi, I am Ava from AppWeaver AI. In under three minutes I will show you how anyone can turn an idea into a real full stack app.',
  prompt: 'It starts with a plain English prompt. Just describe the app you want, and press start.',
  signup: 'Create your free account in seconds. Your details stay private.',
  verify: 'Confirm your email with a one time code, and you are in.',
  build: 'Now the AI agent plans the project and writes the code, a Java or Python backend plus a browser frontend. This takes a few minutes, so I will fast forward.',
  code: 'Here is the generated code, organized into real files you own and can export.',
  preview: 'And here is the live preview, running right now. You can keep chatting to change anything.',
  pricing: 'When you are ready to ship, pick a plan and check out securely with Stripe.',
  outro: 'That is AppWeaver AI. Go from prompt to production app. Start free today at appweaverai dot com.',
};

console.log('Synthesizing narration...');
const voice = {};
let n = 0;
for (const [key, text] of Object.entries(NARRATION)) voice[key] = await synthesize(text, n++);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: RAW, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
const startedAt = Date.now();
const sec = () => (Date.now() - startedAt) / 1000;

await page.addInitScript((av) => {
  const css = document.createElement('style');
  // Mask anything personal that might appear on screen.
  css.textContent =
    'input[type=email],input[autocomplete=one-time-code],input[name*=email i],input[name*=card i],input[name*=cardnumber i]{filter:blur(7px)!important}';
  const build = () => {
    if (!document.head || document.getElementById('aw-avatar')) return;
    document.head.appendChild(css);
    const box = document.createElement('div');
    box.id = 'aw-avatar';
    box.style.cssText =
      'position:fixed;left:18px;bottom:18px;width:150px;height:150px;border-radius:50%;overflow:hidden;z-index:2147483647;border:4px solid #fff;box-shadow:0 6px 24px rgba(0,0,0,.35);background:linear-gradient(160deg,#ffe3d1,#ffc2a1);pointer-events:none';
    box.innerHTML = `<svg viewBox="0 0 100 100" width="150" height="150">
      ${av.long ? `<rect x="22" y="30" width="56" height="58" rx="22" fill="${av.hair}"/>` : ''}
      <path d="M12 100c2-24 18-34 38-34s36 10 38 34z" fill="${av.shirt}"/>
      <rect x="43" y="56" width="14" height="14" rx="5" fill="${av.skin}"/>
      <ellipse cx="50" cy="40" rx="20" ry="23" fill="${av.skin}"/>
      <path d="M29 38c0-17 10-22 21-22s21 6 21 22c-5-9-12-12-21-12s-16 3-21 12z" fill="${av.hair}"/>
      <g class="aw-eyes"><circle cx="42" cy="41" r="2.2" fill="#222"/><circle cx="58" cy="41" r="2.2" fill="#222"/></g>
      <ellipse id="aw-mouth" cx="50" cy="53" rx="6" ry="1.6" fill="#8b2a2a"/>
    </svg>`;
    document.documentElement.appendChild(box);
  };
  let open = false;
  setInterval(() => {
    build();
    const speaking = sessionStorage.getItem('aw-speaking') === '1';
    const mouth = document.getElementById('aw-mouth');
    if (mouth) {
      open = speaking ? !open : false;
      mouth.setAttribute('ry', open ? String(2.5 + Math.random() * 3.5) : '1.6');
    }
    const text = sessionStorage.getItem('aw-caption');
    let el = document.getElementById('aw-caption');
    if (!text) return el?.remove();
    if (!el) {
      el = document.createElement('div');
      el.id = 'aw-caption';
      el.style.cssText =
        'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483646;max-width:62%;margin-left:80px;padding:12px 22px;border-radius:14px;background:rgba(20,20,20,.88);color:#fff;font:600 22px system-ui,sans-serif;text-align:center;pointer-events:none';
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
  }, 140);
}, avatar);

const set = (key, value) =>
  page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [key, value]).catch(() => {});
const caption = (text) => set('aw-caption', text);

const audioCues = []; // { file, rawStart }
const shot = (name) => page.screenshot({ path: path.join(OUT, `.${name}.png`) }).catch(() => {});

/** Presenter speaks `key` while `action` runs; the scene lasts at least as long as the narration. */
async function scene(key, text, action = async () => {}) {
  await caption(text);
  const clip = voice[key];
  audioCues.push({ file: clip.file, rawStart: sec() });
  await set('aw-speaking', '1');
  const minimum = new Promise((r) => setTimeout(r, clip.seconds * 1000 + 400));
  await Promise.all([action(), minimum]);
  await set('aw-speaking', '0');
}

let fast = null; // raw seconds window to fast-forward

try {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Accept all' }).click({ timeout: 8000 }).catch(() => {});

  await scene('intro', 'AppWeaver AI - from idea to full-stack app', async () => {
    await page.waitForTimeout(500);
  });

  const textarea = page.locator('textarea').first();
  await scene('prompt', 'Step 1 - Describe your app in plain English', async () => {
    await textarea.click();
    await textarea.pressSequentially(PROMPT, { delay: 55 });
  });
  await page.getByRole('button', { name: /^(Start|Submit prompt)$/ }).first().click();

  const dialog = page.locator('[role=dialog]');
  await dialog.getByText('Sign up', { exact: true }).first().click();
  await scene('signup', 'Step 2 - Create your free account', async () => {
    await dialog.getByPlaceholder('Ada Lovelace').fill('Demo User');
    await dialog.getByPlaceholder('you@company.com').pressSequentially(email, { delay: 40 });
    await dialog.getByPlaceholder('Create a password').fill(password);
    await dialog.getByPlaceholder('Re-enter your password').fill(password);
    await page.waitForTimeout(600);
    await dialog.getByRole('button', { name: 'Create account' }).click();
  });

  // Depending on config the app either asks for the emailed code or signs in directly.
  const otpInput = dialog.getByPlaceholder('12345678');
  const needsOtp = await Promise.race([
    otpInput.waitFor({ timeout: 15_000 }).then(() => true),
    page.waitForURL(/\/app\/projects\//, { timeout: 15_000 }).then(() => false),
  ]).catch(() => false);
  if (needsOtp) {
    const otp = await readOtp();
    await scene('verify', 'Step 3 - Verify with a one-time code', async () => {
      await otpInput.pressSequentially(otp, { delay: 150 });
      await dialog.getByRole('button', { name: /verify|continue|confirm/i }).first().click().catch(() => {});
    });
  }

  await page.waitForURL(/\/app\/projects\//, { timeout: 120_000 });

  await scene('build', 'Step 4 - The AI agent writes your app', async () => {});
  const buildStart = sec();
  if (DISCOVER) {
    await page.waitForTimeout(90_000);
    await shot('editor');
    console.log(page.url());
    console.log(
      await page.locator('button:visible, [role=tab]:visible, a:visible').evaluateAll((els) =>
        els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 28)).filter(Boolean),
      ),
    );
    throw new Error('discovery done');
  }
  await waitForBuild(page);
  fast = [buildStart, sec()];

  await scene('code', 'Real, exportable source code', async () => {
    await openTab(page, /code|files/i);
    await page.waitForTimeout(2500);
  });
  await scene('preview', 'Live preview - keep chatting to refine', async () => {
    await openTab(page, /preview/i);
    await page.waitForTimeout(2500);
  });

  await scene('pricing', 'Step 5 - Choose a plan and check out securely', async () => {
    await page.goto(`${BASE}/#pricing`);
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /builder|upgrade|get started|choose/i }).first().click();
    await page.waitForURL(/stripe\.com|\/app\/billing/, { timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(3000);
  });
  await scene('outro', 'appweaverai.com - start free today', async () => {});
} catch (error) {
  await shot('error');
  console.error(error);
  process.exitCode = 1;
}

const endRaw = sec();
await context.close();
await browser.close();
await cleanup();
if (process.exitCode) process.exit(process.exitCode);

// ---- Post-production: speed up the AI wait, mix narration, encode MP4 (<= 3 min) ----
const webm = (await import('node:fs')).readdirSync(RAW).find((f) => f.endsWith('.webm'));
if (!webm) throw new Error('No recording produced.');

const waitLen = fast ? fast[1] - fast[0] : 0;
const normal = endRaw - waitLen;
const budget = MAX_SECONDS - 6;
const speed = waitLen ? Math.max(6, waitLen / Math.max(5, budget - normal)) : 1;
const segments = fast
  ? [
      { from: 0, to: fast[0], speed: 1 },
      { from: fast[0], to: fast[1], speed },
      { from: fast[1], to: endRaw, speed: 1 },
    ]
  : [{ from: 0, to: endRaw, speed: 1 }];

const finalTime = (raw) => {
  let t = 0;
  for (const s of segments) {
    if (raw >= s.to) t += (s.to - s.from) / s.speed;
    else if (raw > s.from) return t + (raw - s.from) / s.speed;
  }
  return t;
};

const filters = [];
segments.forEach((s, i) => {
  filters.push(`[0:v]trim=start=${s.from}:end=${s.to},setpts=(PTS-STARTPTS)/${s.speed},fps=25[v${i}]`);
});
filters.push(`${segments.map((_, i) => `[v${i}]`).join('')}concat=n=${segments.length}:v=1:a=0[vout]`);
const audioInputs = [];
audioCues.forEach((cue, i) => {
  const delay = Math.round(finalTime(cue.rawStart) * 1000);
  audioInputs.push('-i', cue.file);
  filters.push(`[${i + 1}:a]adelay=${delay}|${delay}[a${i}]`);
});
filters.push(
  `${audioCues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audioCues.length}:normalize=0[aout]`,
);

const output = path.join(OUT, 'appweaver-demo.mp4');
const result = ffmpeg([
  '-i', path.join(RAW, webm),
  ...audioInputs,
  '-filter_complex', filters.join(';'),
  '-map', '[vout]', '-map', '[aout]',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '128k',
  '-t', String(MAX_SECONDS),
  '-movflags', '+faststart',
  output,
]);
if (result.status !== 0) {
  console.error(result.stderr.slice(-2000));
  process.exit(1);
}

const durationSeconds = Math.round(mediaSeconds(output) * 10) / 10;
if (durationSeconds > MAX_SECONDS) throw new Error(`Video too long: ${durationSeconds}s`);
writeFileSync(
  path.join(OUT, 'meta.json'),
  JSON.stringify({ file: output, durationSeconds, prompt: PROMPT }, null, 2),
);
rmSync(RAW, { recursive: true, force: true });
console.log(`Done: ${output} (${durationSeconds}s)`);
process.exit(0);

// ---- helpers needing the page UI (selectors verified against the app) ----
async function waitForBuild(p) {
  // Done when the agent is no longer streaming: the stop/cancel control disappears.
  await p.waitForTimeout(15_000);
  const failure = p.getByText(/couldn't reach the agent|something went wrong/i).first();
  if (await failure.isVisible().catch(() => false)) {
    throw new Error('The agent failed to build (check AWS Bedrock credentials); refusing to publish this video.');
  }
  await p
    .getByRole('button', { name: /stop|cancel/i })
    .first()
    .waitFor({ state: 'hidden', timeout: 360_000 })
    .catch(() => {});
  if (await failure.isVisible().catch(() => false)) {
    throw new Error('The agent failed to build; refusing to publish this video.');
  }
}

async function openTab(p, name) {
  const tab = p.getByRole('tab', { name }).or(p.getByRole('button', { name })).first();
  await tab.click({ timeout: 10_000 }).catch(() => {});
}
