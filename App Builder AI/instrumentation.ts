import type { Instrumentation } from 'next';

/** Initialises optional error monitoring (a no-op unless SENTRY_DSN is set). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !process.env.SENTRY_DSN) return;
  const { getSentry } = await import('@/lib/monitoring/sentry');
  await getSentry();
}

/** Reports unhandled server errors to monitoring (Sentry if configured) and the alert channel (see lib/alerts.ts). */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const route = request.path.split('?')[0];
  const { captureException } = await import('@/lib/monitoring');
  await captureException(error, {
    tags: { source: 'request', method: request.method },
    extra: { route },
  });
  const { sendAlert } = await import('@/lib/alerts');
  const { scrubText } = await import('@/lib/monitoring/redact');
  const message = error instanceof Error ? error.message : String(error);
  await sendAlert(
    `Server error on ${request.method} ${route}`,
    scrubText(message),
  );
};
