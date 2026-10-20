import { getHealthHistory, checkProjectHealth, recordHealthCheck } from '@/lib/hosting/health';
import { requireProjectAccess } from '@/lib/hosting/api-auth';

type Context = { params: Promise<{ projectId: string }> };

/** Last recorded check plus uptime over the stored checks. */
export async function GET(_request: Request, context: Context) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;

  return Response.json(await getHealthHistory(projectId));
}

/** Runs a fresh check against the live deployment and records it. */
export async function POST(request: Request, context: Context) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;

  const result = await checkProjectHealth(projectId, new URL(request.url).origin);
  await recordHealthCheck(projectId, result);

  return Response.json({ result, ...(await getHealthHistory(projectId)) });
}
