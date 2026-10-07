import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { listImportableRepos } from '@/lib/project-github-import';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;

  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const pageParam = Number.parseInt(searchParams.get('page') ?? '1', 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  try {
    const result = await listImportableRepos(userId, { page });
    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not list GitHub repositories.';
    return Response.json({ error: message }, { status: 400 });
  }
}
