/**
 * Optional Vercel Domains API integration. Only active when both
 * VERCEL_API_TOKEN and VERCEL_PROJECT_ID are set; otherwise callers should
 * show the manual instruction instead of claiming automation.
 */

export type AttachResult =
  | { status: 'attached' }
  | { status: 'skipped'; message: string }
  | { status: 'failed'; message: string };

export const MANUAL_ATTACH_MESSAGE =
  'Automatic attachment is not configured on this deployment. The site operator must add this domain to the hosting project (Vercel → Project → Settings → Domains) for HTTPS to be issued.';

function config() {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) return null;
  const team = process.env.VERCEL_TEAM_ID;
  const query = team ? `?teamId=${encodeURIComponent(team)}` : '';
  return { token, projectId, query };
}

export function isVercelDomainApiConfigured() {
  return config() !== null;
}

export async function attachDomainToVercel(domain: string): Promise<AttachResult> {
  const cfg = config();
  if (!cfg) return { status: 'skipped', message: MANUAL_ATTACH_MESSAGE };

  try {
    const response = await fetch(
      `https://api.vercel.com/v10/projects/${encodeURIComponent(cfg.projectId)}/domains${cfg.query}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: domain }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.ok) return { status: 'attached' };

    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    // Already attached to this project is a success for our purposes.
    if (body?.error?.code === 'domain_already_in_use' && response.status === 409) {
      return { status: 'attached' };
    }
    return {
      status: 'failed',
      message: `Vercel rejected the domain: ${body?.error?.message ?? `HTTP ${response.status}`}`,
    };
  } catch (error) {
    return {
      status: 'failed',
      message: `Could not reach the Vercel API: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
}

export async function detachDomainFromVercel(domain: string): Promise<void> {
  const cfg = config();
  if (!cfg) return;
  await fetch(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(cfg.projectId)}/domains/${encodeURIComponent(domain)}${cfg.query}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(10_000),
    },
  ).catch(() => null);
}
