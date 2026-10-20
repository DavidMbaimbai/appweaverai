import { headers } from 'next/headers';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { getAccessibleProject } from '@/lib/projects/access';
import { denyWithoutCapability } from '@/lib/team/http';
import {
  getProjectCustomDomain,
  countUserCustomDomains,
  removeProjectCustomDomain,
  setProjectCustomDomain,
} from '@/lib/domains/custom-domain';
import { getDnsGuidance } from '@/lib/domains/dns-guidance';
import {
  isVercelDomainApiConfigured,
  MANUAL_ATTACH_MESSAGE,
} from '@/lib/domains/vercel';
import { CUSTOM_DOMAIN_UPGRADE_MESSAGE } from '@/lib/billing/entitlements';
import { checkFeature, checkLimit, resolveEntitlements } from '@/lib/billing/gate';
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
    canUseCustomDomain: resolveEntitlements(user).features.customDomains,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;
  const denied = await denyWithoutCapability(access.userId, projectId, 'manage_domains');
  if (denied) return denied;

  const user = await getUserBillingFields(access.userId);
  const ent = resolveEntitlements(user);
  const locked = checkFeature(ent, 'customDomains');
  if (!locked.allowed) {
    return Response.json(
      { error: locked.message || CUSTOM_DOMAIN_UPGRADE_MESSAGE, upgradeRequired: true, upgradeTo: locked.upgradeTo },
      { status: 403 },
    );
  }

  const alreadyConnected = await getProjectCustomDomain(projectId);
  const overLimit = alreadyConnected
    ? ({ allowed: true } as const)
    : checkLimit(ent, 'customDomains', await countUserCustomDomains(access.userId, projectId));
  if (!overLimit.allowed) {
    return Response.json(
      { error: overLimit.message, upgradeRequired: true, upgradeTo: overLimit.upgradeTo },
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
