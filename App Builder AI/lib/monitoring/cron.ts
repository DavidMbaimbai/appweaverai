import { captureException, captureMessage } from './index';
import { recordJobResult } from './jobs';

/**
 * Wraps a cron route handler: unhandled exceptions and 5xx responses are captured (Sentry when configured) and
 * counted towards the job failure-rate alert. 401/4xx responses are not counted (unauthenticated probes).
 */
export function monitoredCron(job: string, handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      const response = await handler(request);
      const ok = response.status < 500;
      if (!ok) await captureMessage(`Cron ${job} responded ${response.status}`, 'error', { tags: { job } });
      await recordJobResult(job, ok);
      return response;
    } catch (error) {
      await captureException(error, { tags: { job } });
      await recordJobResult(job, false);
      throw error;
    }
  };
}
