import { headers } from 'next/headers';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import {
  connectUserGithubAccount,
  disconnectUserGithubAccount,
  getUserGithubConnectionStatus,
} from '@/lib/github-account';
import { recordUserActivity } from '@/lib/activity/record-user-activity';

const connectSchema = z.object({
  token: z.string().trim().min(1),
});

async function requireUserId() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id ?? null;
}

export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const status = await getUserGithubConnectionStatus(userId);
  return Response.json(status);
}

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = connectSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: 'A GitHub personal access token is required.' },
      { status: 400 },
    );
  }

  try {
    const result = await connectUserGithubAccount(userId, parsed.data.token);
    await recordUserActivity({
      userId,
      action: 'github.account_connected',
      targetType: 'UserGithubConnection',
      after: { githubUsername: result.githubUsername },
    });
    return Response.json({ success: true, githubUsername: result.githubUsername });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not connect GitHub.';
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE() {
  const userId = await requireUserId();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await disconnectUserGithubAccount(userId);
  await recordUserActivity({
    userId,
    action: 'github.account_disconnected',
    targetType: 'UserGithubConnection',
  });

  return Response.json({ success: true });
}
