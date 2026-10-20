'use server';

import { revalidatePath } from 'next/cache';

import { recordUserActivity } from '@/lib/activity/record-user-activity';
import { getCachedSession } from '@/lib/auth/cached';
import { getAppTier } from '@/lib/billing/entitlements';
import { getHostingLimits } from '@/lib/hosting/limits';
import {
  connectIntegration,
  disconnectIntegration,
  listConnections,
  testConnection,
  type ConnectionView,
} from '@/lib/integrations/service';
import {
  createInboundEndpoint,
  createSubscription,
  deleteInboundEndpoint,
  deleteSubscription,
  emitWebhookEvent,
  listDeliveries,
  listInboundEndpoints,
  listInboundEvents,
  listSubscriptions,
} from '@/lib/integrations/webhooks';
import { prisma } from '@/lib/prisma';
import { getAccessibleProject, projectOwnerAccessOr } from '@/lib/projects/access';
import { getUserBillingFields } from '@/lib/queries/billing';
import { rateLimit } from '@/lib/rate-limit';

type Failure = { error: string };

async function authorize(projectId: string, opts: { owner: boolean }) {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return { error: 'You must be signed in.' } as const;
  if (typeof projectId !== 'string' || !projectId) return { error: 'Project not found.' } as const;
  const project = opts.owner
    ? await prisma.project.findFirst({
        where: { id: projectId, deletedAt: null, OR: projectOwnerAccessOr(userId) },
        select: { id: true, slug: true, workspace: { select: { slug: true } } },
      })
    : await getAccessibleProject(projectId, userId, { id: true, slug: true, workspace: { select: { slug: true } } });
  if (!project) {
    return { error: opts.owner ? 'Only the project owner can change integrations.' : 'Project not found.' } as const;
  }
  return { userId, project } as const;
}

function refresh(project: { slug: string; workspace: { slug: string } }) {
  revalidatePath(`/app/projects/${project.workspace.slug}/${project.slug}/integrations`);
}

async function throttled(userId: string, bucket: string, limit = 30) {
  const result = await rateLimit(`integrations:${bucket}:${userId}`, limit, 60_000);
  return result.ok ? null : ({ error: 'Too many requests. Try again shortly.' } as const);
}

export async function listConnectionsAction(projectId: string): Promise<{ connections: ConnectionView[] } | Failure> {
  const auth = await authorize(projectId, { owner: false });
  if (auth.error !== undefined) return { error: auth.error };
  return { connections: await listConnections(projectId) };
}

export async function connectIntegrationAction(
  projectId: string,
  integrationId: string,
  values: Record<string, string>,
): Promise<{ connection: ConnectionView; test: { ok: boolean; message: string; latencyMs: number } } | Failure> {
  const auth = await authorize(projectId, { owner: true });
  if (auth.error !== undefined) return { error: auth.error };
  const limited = await throttled(auth.userId, 'connect', 15);
  if (limited) return limited;

  const tier = getAppTier(await getUserBillingFields(auth.userId));
  const result = await connectIntegration({
    projectId,
    userId: auth.userId,
    integrationId: String(integrationId),
    values: values && typeof values === 'object' ? values : {},
    envVarLimit: getHostingLimits(tier).envVarsPerEnvironment,
  });
  if (!result.ok) return { error: result.error };

  await recordUserActivity({
    userId: auth.userId,
    action: 'project.integration_connected',
    targetType: 'Project',
    targetId: projectId,
    after: { integrationId, testOk: result.test.ok },
  });
  refresh(auth.project);
  return { connection: result.connection, test: result.test };
}

export async function testIntegrationAction(
  projectId: string,
  integrationId: string,
): Promise<{ ok: boolean; message: string; latencyMs: number } | Failure> {
  const auth = await authorize(projectId, { owner: false });
  if (auth.error !== undefined) return { error: auth.error };
  const limited = await throttled(auth.userId, 'test', 20);
  if (limited) return limited;
  const result = await testConnection(projectId, String(integrationId));
  refresh(auth.project);
  return result;
}

export async function disconnectIntegrationAction(projectId: string, integrationId: string): Promise<{ success: true } | Failure> {
  const auth = await authorize(projectId, { owner: true });
  if (auth.error !== undefined) return { error: auth.error };
  const result = await disconnectIntegration(projectId, String(integrationId));
  if (!result.ok) return { error: result.error };
  await recordUserActivity({
    userId: auth.userId,
    action: 'project.integration_disconnected',
    targetType: 'Project',
    targetId: projectId,
    after: { integrationId },
  });
  refresh(auth.project);
  return { success: true };
}

export async function getWebhookPanelAction(projectId: string) {
  const auth = await authorize(projectId, { owner: false });
  if (auth.error !== undefined) return { error: auth.error };
  const [endpoints, events, subscriptions, deliveries] = await Promise.all([
    listInboundEndpoints(projectId),
    listInboundEvents(projectId),
    listSubscriptions(projectId),
    listDeliveries(projectId),
  ]);
  return { endpoints, events, subscriptions, deliveries };
}

/** The signing secret is returned exactly once, at creation. */
export async function createInboundEndpointAction(projectId: string, name: string) {
  const auth = await authorize(projectId, { owner: true });
  if (auth.error !== undefined) return { error: auth.error };
  const result = await createInboundEndpoint(projectId, String(name ?? ''));
  if (!result.ok) return { error: result.error };
  refresh(auth.project);
  return { id: result.endpoint.id, publicId: result.endpoint.publicId, secret: result.secret };
}

export async function deleteInboundEndpointAction(projectId: string, id: string): Promise<{ success: true } | Failure> {
  const auth = await authorize(projectId, { owner: true });
  if (auth.error !== undefined) return { error: auth.error };
  if (!(await deleteInboundEndpoint(projectId, String(id)))) return { error: 'Endpoint not found.' };
  refresh(auth.project);
  return { success: true };
}

export async function createSubscriptionAction(projectId: string, url: string, events: string[]) {
  const auth = await authorize(projectId, { owner: true });
  if (auth.error !== undefined) return { error: auth.error };
  const result = await createSubscription(projectId, String(url ?? ''), Array.isArray(events) ? events.map(String) : []);
  if (!result.ok) return { error: result.error };
  refresh(auth.project);
  return { id: result.subscription.id, secret: result.secret };
}

export async function deleteSubscriptionAction(projectId: string, id: string): Promise<{ success: true } | Failure> {
  const auth = await authorize(projectId, { owner: true });
  if (auth.error !== undefined) return { error: auth.error };
  if (!(await deleteSubscription(projectId, String(id)))) return { error: 'Subscription not found.' };
  refresh(auth.project);
  return { success: true };
}

export async function sendTestWebhookAction(projectId: string, subscriptionId: string): Promise<{ queued: number } | Failure> {
  const auth = await authorize(projectId, { owner: true });
  if (auth.error !== undefined) return { error: auth.error };
  const limited = await throttled(auth.userId, 'webhook-test', 10);
  if (limited) return limited;
  const queued = await emitWebhookEvent(projectId, 'webhook.test', { message: 'Test event from AppWeaver' }, String(subscriptionId));
  if (queued === 0) return { error: 'Subscription not found, inactive, or not listening to webhook.test.' };
  refresh(auth.project);
  return { queued };
}
