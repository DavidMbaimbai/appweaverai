import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { getAppTier, type AppTier } from '@/lib/billing/entitlements';
import { getAccessibleProject } from '@/lib/projects/access';
import { getUserBillingFields } from '@/lib/queries/billing';

/** Resolves the signed-in user, their plan tier, and project access for API routes. */
export async function requireProjectAccess(
  projectId: string,
): Promise<{ userId: string; tier: AppTier } | { error: Response }> {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;

  if (!userId) {
    return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const project = await getAccessibleProject(projectId, userId, { id: true });
  if (!project) {
    return {
      error: Response.json({ error: 'Project not found.' }, { status: 404 }),
    };
  }

  const user = await getUserBillingFields(userId);
  return { userId, tier: getAppTier(user) };
}
