import { prisma } from '@/lib/prisma';
import { defaultAdapters, syncPostInsights, type PlatformConnection } from '@/lib/marketing/insights-sync';
import { decryptSecret } from '@/lib/crypto/secret-box';

/** WIRE THIS to wherever publishDueProjectPosts reads social tokens (decrypting them). */
async function getConnection(projectId: string, platform: string): Promise<PlatformConnection | null> {
  const campaign = await prisma.projectCampaign.findFirst({
    where: { projectId },
    select: { userId: true },
  });
  if (!campaign) return null;

  const connection = await prisma.socialConnection.findUnique({
    where: {
      userId_platform: {
        userId: campaign.userId,
        platform: platform.toUpperCase() as never,
      },
    },
  });

  if (!connection) return null;

  const accessToken = decryptSecret(connection.accessTokenEnc);
  if (!accessToken) return null;

  return {
    accessToken,
    accountId: connection.accountId ?? undefined,
  };
}

async function markConnectionNeedsReauth(projectId: string, platform: string) {
  const campaign = await prisma.projectCampaign.findFirst({
    where: { projectId },
    select: { userId: true },
  });
  if (!campaign) return;

  await prisma.socialConnection.update({
    where: {
      userId_platform: {
        userId: campaign.userId,
        platform: platform.toUpperCase() as never,
      },
    },
    data: { expiresAt: new Date(0) }, // Force reauth
  });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const summary = await syncPostInsights({
    adapters: defaultAdapters,
    getConnection,
    onAuthError: markConnectionNeedsReauth,
  });
  return Response.json(summary);
}