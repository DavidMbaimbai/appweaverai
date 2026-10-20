import { scrubText, scrubValue } from './redact';

type SentryModule = typeof import('@sentry/nextjs');

let loading: Promise<SentryModule | null> | null = null;

/** Sentry is optional: nothing is imported or initialised unless SENTRY_DSN is set. */
export function isSentryEnabled() {
  return Boolean(process.env.SENTRY_DSN?.trim());
}

export function getSentry(): Promise<SentryModule | null> {
  if (!isSentryEnabled()) return Promise.resolve(null);
  loading ??= import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV,
        release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA,
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
        dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
        beforeSend(event) {
          if (event.message) event.message = scrubText(event.message);
          for (const exception of event.exception?.values ?? []) {
            if (exception.value) exception.value = scrubText(exception.value);
          }
          if (event.request) {
            delete event.request.cookies;
            delete event.request.headers;
            delete event.request.data;
          }
          if (event.extra) event.extra = scrubValue(event.extra) as typeof event.extra;
          return event;
        },
      });
      return Sentry;
    })
    .catch((error) => {
      console.error('[monitoring] Sentry failed to load:', error);
      return null;
    });
  return loading;
}
