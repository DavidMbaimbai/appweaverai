import { getSentry } from './sentry';
import { recordJobResult } from './jobs';
import { scrubText, scrubValue } from './redact';

export { recordJobResult } from './jobs';
export { isSentryEnabled } from './sentry';

export type MonitoringContext = {
  /** Low-cardinality labels, e.g. { job: 'observatory', source: 'stripe-webhook' }. */
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
};

type Level = 'info' | 'warning' | 'error';

/**
 * Vendor-neutral error capture. Always logs a redacted line to the server console; additionally forwards to
 * Sentry when SENTRY_DSN is set. Never throws and never leaks secrets/PII.
 */
export async function captureException(error: unknown, context: MonitoringContext = {}) {
  try {
    const message = scrubText(error instanceof Error ? error.message : String(error));
    const tags = context.tags ? JSON.stringify(scrubValue(context.tags)) : '';
    console.error(`[monitoring] ${message}${tags ? ` ${tags}` : ''}`);
    const Sentry = await getSentry();
    Sentry?.withScope((scope) => {
      if (context.tags) scope.setTags(scrubValue(context.tags) as Record<string, string>);
      if (context.extra) scope.setExtras(scrubValue(context.extra) as Record<string, unknown>);
      Sentry.captureException(error);
    });
  } catch {
    // monitoring must never break the request it is observing
  }
}

export async function captureMessage(message: string, level: Level = 'error', context: MonitoringContext = {}) {
  try {
    const clean = scrubText(message);
    if (level !== 'info') console.error(`[monitoring] ${clean}`);
    const Sentry = await getSentry();
    Sentry?.withScope((scope) => {
      scope.setLevel(level);
      if (context.tags) scope.setTags(scrubValue(context.tags) as Record<string, string>);
      if (context.extra) scope.setExtras(scrubValue(context.extra) as Record<string, unknown>);
      Sentry.captureMessage(clean);
    });
  } catch {
    // see above
  }
}

/** Records a failed unit of work (webhook, agent run, provider call): capture plus failure-rate tracking. */
export async function reportFailure(job: string, error: unknown, context: MonitoringContext = {}) {
  await captureException(error, { ...context, tags: { ...context.tags, job } });
  await recordJobResult(job, false);
}
