import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { hasProjectAccess } from '@/lib/projects/access';
import {
  getBackendHostPort,
  isBackendPreviewEnabled,
} from '@/lib/backend-preview/manager';
import { BACKEND_RUNTIMES, detectBackend } from '@/lib/backend-preview/runtimes';
import { listWorkspaceRelativePaths } from '@/lib/preview/list-workspace-paths';

type Context = {
  params: Promise<{
    projectId: string;
    artifactSlug: string;
    path?: string[];
  }>;
};

/** Never forward the app's session or let user code set cookies on our origin. */
const BLOCKED_REQUEST_HEADERS = new Set([
  'host',
  'cookie',
  'authorization',
  'connection',
  'content-length',
  'x-forwarded-for',
  'x-forwarded-host',
]);
const BLOCKED_RESPONSE_HEADERS = new Set([
  'set-cookie',
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
]);

function unavailable(message: string, status = 503) {
  return Response.json({ error: message }, { status });
}

async function proxy(request: Request, context: Context) {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  const { projectId, artifactSlug, path = [] } = await context.params;

  if (!userId || !(await hasProjectAccess(projectId, userId))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isBackendPreviewEnabled()) {
    return unavailable('Backend preview is disabled.');
  }

  const backend = detectBackend(
    await listWorkspaceRelativePaths(projectId, artifactSlug),
  );
  if (!backend) return unavailable('This artifact has no backend.', 404);

  const port = await getBackendHostPort(
    projectId,
    artifactSlug,
    BACKEND_RUNTIMES[backend.kind].port,
  );
  if (!port) return unavailable('Backend is not running.');

  const incoming = new URL(request.url);
  const target = `http://127.0.0.1:${port}/${path.map(encodeURIComponent).join('/')}${incoming.search}`;

  const forwardHeaders = new Headers();
  request.headers.forEach((value, key) => {
    if (!BLOCKED_REQUEST_HEADERS.has(key.toLowerCase())) {
      forwardHeaders.set(key, value);
    }
  });

  const hasBody = !['GET', 'HEAD'].includes(request.method);

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: forwardHeaders,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });

    const responseHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      if (!BLOCKED_RESPONSE_HEADERS.has(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    });

    responseHeaders.set('content-security-policy', "sandbox; default-src 'none'");
    responseHeaders.set('x-content-type-options', 'nosniff');
    responseHeaders.set('cache-control', 'no-store');

    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return unavailable('Backend did not respond (it may still be starting).', 502);
  }
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as OPTIONS,
};
