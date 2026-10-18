import type { Instrumentation } from 'next';

/** Reports unhandled server errors to the alert channel (see lib/alerts.ts). */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { sendAlert } = await import('@/lib/alerts');
  const message = error instanceof Error ? error.message : String(error);
  await sendAlert(
    `Server error on ${request.method} ${request.path.split('?')[0]}`,
    message,
  );
};
