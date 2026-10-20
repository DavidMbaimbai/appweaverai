import { headers } from 'next/headers';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { getAccessibleProject } from '@/lib/projects/access';
import {
  getProjectCustomDomain,
  countUserCustomDomains,
  removeProjectCustomDomain,
  setProjectCustomDomain,
} from '@/lib/domains/custom-domain';
import {
  customDomainLimitMessage,
  getHostingLimits,
} from '@/lib/hosting/limits';
import { getDnsGuidance } from '@/lib/domains/dns-guidance';
import {
  isVercelDomainApiConfigured,
  MANUAL_ATTACH_MESSAGE,
} from '@/lib/domains/vercel';
import {
  CUSTOM_DOMAIN_UPGRADE_MESSAGE,
  canUseCustomDomain,
  getAppTier,
} from '@/lib/billing/entitlements';
import { getUserBillingFields } from '@/lib/queries/billing';
import { recordUserActivity } from '@/lib/activity/record-user-activity';

const setSchema = z.object({
  domain: z.string().trim().min(1),
});

function attachInfo() {
  return isVercelDomainApiConfigured()
    ? 'When you verify, the domain is attached to the hosting project automatically and HTTPS is issued by the platform.'
    : MANUAL_ATTACH_MESSAGE;
}

async function requireProjectAccess(
  projectId: string,
): Promise<{ userId: string } | { error: Response }> {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;

  if (!userId) {
    return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const project = await getAccessibleProject(projectId, userId, { id: true });
  if (!project) {
    return { error: Response.json({ error: 'Project not found.' }, { status: 404 }) };
  }

  return { userId };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;

  const user = await getUserBillingFields(access.userId);
  const record = await getProjectCustomDomain(projectId);
  return Response.json({
    domain: record,
    guidance: record
      ? getDnsGuidance(record.domain, record.verificationToken)
      : null,
    attachInfo: attachInfo(),
    canUseCustomDomain: canUseCustomDomain(getAppTier(user)),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;

  const user = await getUserBillingFields(access.userId);
  const tier = getAppTier(user);
  const domainLimit = getHostingLimits(tier).customDomains;
  if (!canUseCustomDomain(tier)) {
    return Response.json(
      { error: CUSTOM_DOMAIN_UPGRADE_MESSAGE, upgradeRequired: true },
      { status: 403 },
    );
  }

  const alreadyConnected = await getProjectCustomDomain(projectId);
  if (
    !alreadyConnected &&
    (await countUserCustomDomains(access.userId, projectId)) >= domainLimit
  ) {
    return Response.json(
      { error: customDomainLimitMessage(tier, domainLimit), upgradeRequired: false },
      { status: 403 },
    );
  }

  const json = await request.json().catch(() => null);
  const parsed = setSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'Enter a domain to connect.' }, { status: 400 });
  }

  try {
    const record = await setProjectCustomDomain(projectId, parsed.data.domain);
    await recordUserActivity({
      userId: access.userId,
      action: 'project.custom_domain_set',
      targetType: 'Project',
      targetId: projectId,
      after: { domain: record.domain },
    });
    return Response.json({
      success: true,
      domain: record,
      guidance: getDnsGuidance(record.domain, record.verificationToken),
      attachInfo: attachInfo(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not save this domain.';
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;

  await removeProjectCustomDomain(projectId);
  await recordUserActivity({
    userId: access.userId,
    action: 'project.custom_domain_removed',
    targetType: 'Project',
    targetId: projectId,
  });

  return Response.json({ success: true });
}
