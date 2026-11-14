# Production authentication investigation — 2026-10-26

## Scope and evidence

Follow-up production build failure: commit `1babd9a` included imports of `@/lib/auth/clear-sign-in-error` and `@/lib/auth/password-errors`, but the two implementation files remained untracked locally. Both filenames match their imports exactly, and `git check-ignore` confirmed neither is excluded. The completion commit adds both helpers, their unit tests, the browser regression and its configuration, plus this investigation and the read-only diagnostic. This fixes missing build inputs; it does not establish successful affected-account authentication.

The underlying affected-account login failure is **not verified or repaired**. No SSH connection or affected-user credentials were supplied. Historical PM2 messages were not used as current evidence. No production database, environment, PM2 process, passwords, roles, verification settings or storage were changed.

Fresh external diagnostics (UTC):

| Time | Request | Status | Sanitized response |
| --- | --- | --- | --- |
| 20:40:15 | GET / | 200 | HTML omitted |
| 20:40:15 | GET /api/auth/get-session | 200 | null (anonymous) |
| 20:40:15 | POST /api/auth/sign-in/social | 200 | Google authorization URL; callback https://appweaverai.com/api/auth/callback/google |
| 20:40:44 | POST /api/auth/sign-in/email | 401 | INVALID_EMAIL_OR_PASSWORD / Invalid email or password |

The password request used a deliberately nonexistent diagnostic account and a randomly generated value, not the affected account. No request secrets or OAuth state were recorded. Corresponding fresh server logs remain unavailable. OAuth initiation does not validate the client secret or complete sign-in.

Verified UI defect: `lib/auth/oauth-errors.ts` mapped `invalid_code` unconditionally to an expired/used link. Installed Better Auth 1.7.5 catches *all* authorization-code exchange exceptions and redirects with `invalid_code`, including provider credential rejection. See `node_modules/better-auth/dist/api/routes/callback.mjs` and [upstream implementation](https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/api/routes/callback.ts). The corrected message does not infer the cause. Password and OAuth errors have separate messages; starting an attempt clears stale error/query state while preserving the destination.

## Traced implementation

Validation: 106 unit-test files / **1,014 tests passed**; the Playwright stale-OAuth-to-password regression passed (26.2 seconds); focused ESLint and syntax checks passed. `npm run build` completed with exit 0 on Next.js 16.4.2 after regenerating Prisma Client 7.10.1. Local database authentication failures appeared during optional testimonial prerendering, and existing dynamic-filesystem tracing warnings remained; neither prevented build completion or proves anything about production. Package and lock files were not modified. The initial install was stale; `npm install --no-save --no-audit --no-fund` repaired local dependencies after `npm ci` rejected missing optional lock entries.

Changed application files: `components/auth/auth-modal.tsx`, `components/admin/login/admin-login-form.tsx`, `lib/auth/oauth-errors.ts`, `lib/auth/password-errors.ts`, `lib/auth/clear-sign-in-error.ts`. Regression coverage: `lib/auth/oauth-errors.test.ts`, `lib/auth/password-errors.test.ts`, `e2e/auth-errors.spec.ts`, `playwright.auth.config.ts`. Operational additions: `scripts/diagnose-auth.mjs` and this document.

Reproduce local UI regression with `npx playwright test --config playwright.auth.config.ts`. This test uses mocked auth responses, not successful real authentication.

`components/auth/auth-modal.tsx` → `lib/auth-client.ts` (same-origin Better Auth React client) → `app/api/auth/[...all]/route.ts` → `lib/auth.ts` → `@better-auth/prisma-adapter` (PostgreSQL) → lazy Prisma client with `PrismaPg` in `lib/prisma.ts`.

- Password: POST `/api/auth/sign-in/email`; enabled by `emailAndPassword.enabled`. Requires an existing `credential` account with a valid password hash.
- Google: POST `/api/auth/sign-in/social`, then `/api/auth/callback/google`. Both client variables must be present; presence does not prove a matching pair.
- Schema maps `User`, `Account`, `Session`, `Verification` to `users`, `accounts`, `sessions`, `verifications`; credential provider/password fields exist in schema and migrations. Actual production migration/client compatibility is unverified.
- `ADMIN_SEED_PASSWORD` does **not** update an existing password. The existing admin bootstrap can update roles/status on an admin-page request; do not use that page as a diagnostic seed operation.
- Auth secrets, database connection and social provider credentials are server environment reads at module/client initialization. Restart is required after changes. No `next.config.ts` env inlining was found. `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is build-time; provider button visibility can also be prerendered. Rebuild after relevant configuration changes.
- Next.js precedence: PM2/process env → `.env.production.local` → `.env.local` → `.env.production` → `.env`. Editing `.env` cannot override PM2 variables. Prisma CLI configuration loads `.env.local` then `.env`, which can differ from the app's effective environment.
- Secure cookies are enabled in production, HTTP-only, SameSite=Lax. No cookie/security configuration was changed. The trusted origin includes Better Auth's configured base URL; there is no custom trusted-origin list here.
- A changed `BETTER_AUTH_SECRET` can invalidate previously signed sessions/pending flows. It does not repair a credential password. Rotation history and effective production values are unverified.
- Existing `auth-url-sync.tsx` already consumes URL errors and strips auth query parameters; the expired-link wording could appear before any password request. This is not evidence that a password request returned an OAuth error.

## Read-only production checks still required

Run as the owner of the existing PM2 processes, inside the production checkout:

```bash
cd '/var/www/appweaverai/appweaverai-latest/App Builder AI'
node scripts/diagnose-auth.mjs
```

This reports only process paths/status, environment presence/source/equality flags, account provider names, password-presence booleans, verification status and applied migration count. It uses the target PM2 environment and Next.js file precedence, and a read-only database transaction. It never prints secrets, hashes, tokens or raw database errors. Compare the expected production database privately; equality with the previous checkout's base `.env` is only a clue, not proof of the old process's effective environment. Do not dump `pm2 env`, `pm2 jlist`, `.env`, cookie headers, HAR files or raw OAuth error objects into a report.

The diagnostic reconstructs configuration from **current files**, not the running Next.js process's memory. It now reports environment files modified after the PM2 process started. If any changed, confirm deployment history before equating the queried database/configuration with the running application's database/configuration.

To inspect before deploying any application changes, upload just the diagnostic (replace `USER@HOST` with the actual PM2 owner's SSH connection):

```powershell
scp "C:/Users/user/IdeaProjects/appweaverai/App Builder AI/scripts/diagnose-auth.mjs" USER@HOST:/tmp/appweaverai-diagnose-auth.mjs
ssh USER@HOST "node /tmp/appweaverai-diagnose-auth.mjs"
```

Follow-up access check: neither user nor system SSH configuration exists on this machine, no active SSH client session was found, and no repository configuration identifies the production SSH username or key. Available unrelated key filenames do not establish AppWeaver access. Account existence/providers, an actual affected-account failure, fresh correlated server logs, and deployment remain blocked on a usable production connection. No new production login attempts or credential guesses were made in the follow-up.

Inspect the old `appweaverai` process's executable/cwd, port listeners and Nginx routing before changing it. Leave it untouched unless its purpose is established. Review only the relevant Nginx directives: upstream must be `127.0.0.1:3002`, `Host $host`, `X-Forwarded-Proto $scheme`, and `X-Forwarded-For $proxy_add_x_forwarded_for`. Do not broaden origins or relax cookies.

Compare auth source files in `/var/www/appweaverai/App Builder AI` against the current checkout, excluding all `.env*` files and generated/runtime storage. Check `git status` in each checkout for previous uncommitted fixes. Do not overwrite unrelated local changes.

Capture a fresh affected-user password attempt in a private browser window. Record UTC time, method, path, status and allowlisted error code/message only. Inspect only log bytes appended to `appweaverai-v2` after that start time. Record a sanitized error classification and timestamp, never raw OAuth exception objects (which may contain credentials), request bodies, cookies, tokens, authorization headers or callback codes. Repeat Google separately. Confirm the browser subsequently receives a session and can open `/app`; a homepage 200 or session-null 200 is insufficient.

If fresh Google logs confirm `invalid_client`, the required external setting is the **Google Cloud OAuth 2.0 Web application client's active secret belonging to the same client ID**. Set that exact pair in the effective production configuration, preserving unrelated values. Register **https://appweaverai.com/api/auth/callback/google** as an authorized redirect URI for that client. This setting is verified from the fresh initiation response. No credentials were invented or rotated here.

## Deploy this limited error-handling patch

The supplied archive contains only the named source/test/diagnostic/documentation files, never `.env`, dependencies, build output or generated project storage. It is an error-reporting patch, not proof of restored production authentication. Supply `USER@HOST` using the actual PM2 owner/SSH connection. From the local machine:

```powershell
scp C:/Users/user/IdeaProjects/appweaverai-auth-fix.tar.gz USER@HOST:/tmp/appweaverai-auth-fix.tar.gz
```

On the server, use Bash. Inspect the archive list and reconcile any existing changes in those files first:

```bash
set -euo pipefail
cd '/var/www/appweaverai/appweaverai-latest/App Builder AI'
tar -tzf /tmp/appweaverai-auth-fix.tar.gz
git status --short
backup="/var/www/appweaverai/auth-fix-backup-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$backup"
tar -tzf /tmp/appweaverai-auth-fix.tar.gz > "$backup/files.txt"
while IFS= read -r file; do
  if [ -f "$file" ]; then
    mkdir -p "$backup/source/$(dirname "$file")"
    cp -p -- "$file" "$backup/source/$file"
  fi
done < "$backup/files.txt"
cp -a .next "$backup/build"
tar -xzf /tmp/appweaverai-auth-fix.tar.gz
node scripts/diagnose-auth.mjs
npx prisma generate
npm test
npm run build
pm2 restart appweaverai-v2
pm2 save
curl --silent --show-error --output /dev/null --write-out 'local homepage: %{http_code}\n' http://127.0.0.1:3002/
curl --silent --show-error --output /dev/null --write-out 'public homepage: %{http_code}\n' https://appweaverai.com/
curl --silent --show-error https://appweaverai.com/api/auth/get-session
```

Keep the existing PM2 executable, cwd, host and port; do not create/delete processes. A plain restart preserves PM2 variables. If a verified environment correction is needed, update its actual source and restart with the reviewed PM2 configuration; `--update-env` alone is not a reliable way to remove a stale PM2 variable. Rebuild if a public variable or prerendered provider configuration changes. Do not source `.env` as shell code.

No migrations or dependency changes are needed for this patch. Use the server's existing working dependencies. Local `npm ci` was blocked by pre-existing missing optional `@emnapi` lock entries; do not regenerate or upgrade production dependencies casually.

After restart, perform the two real browser flows above and correlate fresh logs before declaring the incident resolved. If checks fail, restore backed-up source files from `$backup/source/`, move the failed `.next` to a sibling path for inspection, copy `$backup/build` back as `.next`, and restart only `appweaverai-v2`. Keep all generated projects and runtime storage intact. No deployment was executed during this investigation.
