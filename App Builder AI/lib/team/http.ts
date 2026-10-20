import { requireProjectCapability } from './access';
import type { Capability } from './permissions';

/** For API routes: a JSON error Response when the caller's team role lacks the capability, otherwise null. */
export async function denyWithoutCapability(userId: string, projectId: string, capability: Capability): Promise<Response | null> {
  const access = await requireProjectCapability(userId, projectId, capability);
  if (access.ok) return null;
  return Response.json({ error: access.error }, { status: access.status });
}
