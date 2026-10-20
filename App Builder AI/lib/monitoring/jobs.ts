import { sendAlert } from '@/lib/alerts';

const WINDOW_MS = 30 * 60 * 1000;
const MIN_SAMPLES = 3;
const FAILURE_RATE_THRESHOLD = 0.5;
const MAX_SAMPLES_PER_JOB = 100;

const samples = new Map<string, Array<{ at: number; ok: boolean }>>();

export type JobHealth = { total: number; failures: number; rate: number };

export function jobHealth(job: string, now = Date.now()): JobHealth {
  const recent = (samples.get(job) ?? []).filter((sample) => now - sample.at < WINDOW_MS);
  const failures = recent.filter((sample) => !sample.ok).length;
  return { total: recent.length, failures, rate: recent.length ? failures / recent.length : 0 };
}

/** Pure decision used by recordJobResult: alert once enough runs in the window failed. */
export function shouldAlertOnFailureRate(health: JobHealth) {
  return health.total >= MIN_SAMPLES && health.failures >= 2 && health.rate >= FAILURE_RATE_THRESHOLD;
}

/**
 * Tracks cron/job outcomes per server instance and sends an alert (ALERT_WEBHOOK_URL / ALERT_EMAIL, throttled by
 * sendAlert) when the recent failure rate is high. Instance-local by design: serverless instances do not share state.
 */
export async function recordJobResult(job: string, ok: boolean, now = Date.now()) {
  const recent = (samples.get(job) ?? []).filter((sample) => now - sample.at < WINDOW_MS);
  recent.push({ at: now, ok });
  samples.set(job, recent.slice(-MAX_SAMPLES_PER_JOB));
  if (ok) return;

  const health = jobHealth(job, now);
  if (shouldAlertOnFailureRate(health)) {
    await sendAlert(
      `Job "${job}" failure rate high`,
      `${health.failures}/${health.total} runs failed in the last ${WINDOW_MS / 60000} minutes.`,
    );
  }
}

export function resetJobHealthForTests() {
  samples.clear();
}
