import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

// Anything that proves who the caller is (session / admin / project access) or that the request carries a secret or signature.
const GUARD_TOKENS = [
  'getSession(', 'getCachedSession', 'requireUser(', 'requireUserId(', 'requireAdmin', 'requireProjectAccess',
  'getAccessibleProject', 'hasProjectAccess', 'getAuthorizedProject', 'hasBearerSecret', 'authorizePreviewAccess',
  'authorizeStagingAccess', 'verifyTwilioSignature', 'verifyVoiceRequest', 'verifyMeetingToken', 'verifyUnsubscribeToken',
  'findPublicProject', 'constructEvent', 'verifyMetaSignature', 'verifyWebhook',
];

/** Files that are intentionally reachable without a session. Each needs a justification. */
const ALLOWLIST: Record<string, string> = {
  'app/api/auth/[...all]/route.ts': 'public: better-auth handler, performs its own authentication',
  'app/api/cli/device/code/route.ts': 'public: OAuth device-flow start, rate limited, issues only a pairing code',
  'app/api/cli/device/token/route.ts': 'public: OAuth device-flow poll, rate limited, requires the secret device code',
  'app/api/domains/resolve/route.ts': 'public: maps a custom domain to its published path, no tenant data returned',
  'app/api/health/route.ts': 'public: liveness probe, returns no tenant data',
  'app/api/privacy/request/route.ts': 'public: privacy-request intake, rate limited; owned by lib/privacy (confirm its verification)',
  'app/api/messaging/webchat/widget/route.ts': 'public: static widget script, no tenant data',
  'app/api/projects/[projectId]/forms/submit/route.ts': 'public: visitor form submission, rate limited, only writes to that active project',
  'app/api/projects/[projectId]/leads/widget/route.ts': 'public: widget script for one project, embeds only its id',
  'app/api/projects/[projectId]/reviews/widget/route.ts': 'public: widget script for one project, embeds only its id',
  'app/api/growth/track/route.ts': 'public: first-party visit beacon, consent and DNT/GPC gated, rate limited, stores no IP and returns no data',
  'app/api/integrations/proxy/[connectionId]/route.ts': 'public by design: called by generated apps; authenticated by a per-project secret token (timing-safe), rate limited and quota-capped in lib/integrations/proxy.ts',
  'app/api/webhooks/inbound/[publicId]/route.ts': 'public by design: HMAC-signed, replay-protected and idempotent inbound webhooks (lib/integrations/webhooks.ts)',
};

function walk(dir: string, match: (file: string) => boolean, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, match, out);
    else if (match(full)) out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');

const routes = walk(path.join(ROOT, 'app', 'api'), (f) => path.basename(f) === 'route.ts').map(rel).sort();
const actions = walk(path.join(ROOT, 'lib', 'actions'), (f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f)).map(rel).sort();
const source = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
const hasGuard = (file: string) => GUARD_TOKENS.some((token) => source(file).includes(token));

describe('tenant isolation static guard', () => {
  it('finds the route and action files it is meant to police', () => {
    expect(routes.length).toBeGreaterThan(50);
    expect(actions.length).toBeGreaterThan(10);
  });

  it('every API route and server-action file has a recognised auth guard or an explicit allowlist entry', () => {
    const unguarded = [...routes, ...actions].filter((file) => !hasGuard(file) && !(file in ALLOWLIST));
    expect(unguarded, 'Add an auth guard, or allowlist the file with a justification').toEqual([]);
  });

  it('keeps the allowlist honest: no stale entries and every entry justified', () => {
    const all = new Set([...routes, ...actions]);
    expect(Object.keys(ALLOWLIST).filter((file) => !all.has(file))).toEqual([]);
    expect(Object.entries(ALLOWLIST).filter(([, why]) => why.trim().length < 20)).toEqual([]);
  });

  it('cron and outreach/social job routes verify the bearer secret', () => {
    const jobs = routes.filter(
      (file) => /^app\/api\/(cron|outreach|social)\//.test(file) && !file.includes('/unsubscribe/'),
    );
    expect(jobs.length).toBeGreaterThan(10);
    expect(jobs.filter((file) => !source(file).includes('hasBearerSecret'))).toEqual([]);
  });
});
