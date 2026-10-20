import { prisma } from '@/lib/prisma';

export type CampaignBillingClass = 'APPWEAVER_INTERNAL' | 'CUSTOMER_MARKETING';

export class BillingClassificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingClassificationError';
  }
}

function csv(raw: string | undefined) {
  return new Set((raw ?? '').split(',').map((s) => s.trim()).filter(Boolean));
}

/**
 * Pure decision. INTERNAL requires an admin role AND a platform scope (a platform
 * account listed in PLATFORM_ADMIN_USER_IDS, or a project in PLATFORM_WORKSPACE_IDS).
 * `claimed` is only ever used to reject a mismatch - it never grants anything.
 */
export function decideBilling(input: {
  userId: string;
  hasAdminRole: boolean;
  workspaceId?: string | null;
  claimed?: CampaignBillingClass | null;
  env?: NodeJS.ProcessEnv;
}): CampaignBillingClass {
  const env = input.env ?? process.env;
  const platformUsers = csv(env.PLATFORM_ADMIN_USER_IDS);
  const platformWorkspaces = csv(env.PLATFORM_WORKSPACE_IDS);
  const inPlatformScope =
    platformUsers.has(input.userId) || (!!input.workspaceId && platformWorkspaces.has(input.workspaceId));
  const internal = input.hasAdminRole && inPlatformScope;
  if (input.claimed === 'APPWEAVER_INTERNAL' && !internal) {
    throw new BillingClassificationError('Customers cannot run operations as AppWeaver internal marketing.');
  }
  return internal ? 'APPWEAVER_INTERNAL' : 'CUSTOMER_MARKETING';
}

export type BillingContext = {
  billing: CampaignBillingClass;
  /** Wallet owner (workspace billing owner for customers). */
  walletUserId: string;
  /** Organisation key for reports and limits. */
  orgId: string;
  projectId: string | null;
  plan: string;
};

/** Resolves classification from the database only; never from request fields. */
export async function resolveBillingContext(input: {
  userId: string;
  projectId?: string | null;
  claimed?: CampaignBillingClass | null;
}): Promise<BillingContext> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { adminRole: true, subscriptionPlan: true },
  });
  if (!user) throw new BillingClassificationError('Account not found.');

  let workspaceId: string | null = null;
  let walletUserId = input.userId;
  if (input.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: input.projectId },
      select: {
        workspaceId: true,
        members: { where: { userId: input.userId }, select: { userId: true } },
        workspace: { select: { ownerId: true, members: { where: { userId: input.userId }, select: { userId: true } } } },
      },
    });
    if (!project) throw new BillingClassificationError('Project not found.');
    const owns =
      project.workspace.ownerId === input.userId ||
      project.workspace.members.length > 0 ||
      project.members.length > 0;
    const isAdmin = !!user.adminRole;
    if (!owns && !isAdmin) throw new BillingClassificationError('You do not have access to this project.');
    workspaceId = project.workspaceId;
    walletUserId = project.workspace.ownerId;
  }

  const billing = decideBilling({
    userId: input.userId,
    hasAdminRole: !!user.adminRole,
    workspaceId,
    claimed: input.claimed,
  });
  return {
    billing,
    walletUserId,
    orgId: workspaceId ?? `user:${input.userId}`,
    projectId: input.projectId ?? null,
    plan: user.subscriptionPlan,
  };
}
