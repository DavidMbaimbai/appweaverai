# Tenant-isolation audit

Scope: every `app/api/**/route.ts` (102), `lib/actions/*` (32 files), `lib/admin/actions/*` (16), the other `'use server'` files (`lib/agents/project-actions.ts`, `lib/auth/actions.ts`, `lib/content-pipeline/actions.ts`, `lib/feedback/actions.ts`, `lib/sales/actions.ts`) and the dynamic pages. Excluded (owned by other work): `lib/privacy/*`, `lib/code-scan/*`.

Central guards: `lib/projects/access.ts` (`projectAccessWhere`, `getAccessibleProject`, `hasProjectAccess`, `projectMemberAccessOr`, `projectOwnerAccessOr`), `lib/hosting/api-auth.ts` (`requireProjectAccess`), `lib/agent/access.ts` (`getAuthorizedProject`, `getArtifactForProject`), `lib/rate-limit.ts` (`hasBearerSecret`, fail-closed, constant-time), `lib/auth/require-user.ts`, `lib/auth/cached.ts`, `lib/project-reviews/public-api.ts` (`findPublicProject`), `requireAdmin(permission)`.

## Gaps found and fixed

| # | Where | Gap | Fix |
|---|-------|-----|-----|
| 1 | `POST /api/projects/[projectId]/agent` | A client-supplied `conversationId` was trusted: user A could append messages to, and run the agent against, B's conversation. | Conversation is verified with `findFirst({ id, projectId })`, else 404. |
| 2 | Owner-level checks (`lib/agents/project-actions.ts`, `lib/content-pipeline/actions.ts`, `lib/actions/calendar.ts`, `lib/actions/meetings.ts`, `calendar` route, inbox / agents / content-pipeline pages) | Used `OR: [createdById, workspace.ownerId]`, so a creator removed from the workspace kept control. | New `projectOwnerAccessOr(userId)`: creator **while still having access**, or workspace owner. |
| 3 | `saveProjectBudgetAction` (`lib/actions/marketing-credits.ts`) | Only `resolveBillingContext` ran, which lets any admin role through and trusted creator-only ownership. | Calls `hasProjectAccess` first. `resolveBillingContext` no longer trusts `createdById`; it accepts workspace owner, workspace member or project member (admin bypass unchanged). |

## Public / cron / webhook allowlist (enforced by `lib/security/tenant-guard.test.ts`)

| File | Why it needs no session |
|------|-------------------------|
| `api/auth/[...all]` | better-auth handler |
| `api/cli/device/code`, `token` | OAuth device flow; rate limited; secret device code |
| `api/domains/resolve` | domain to published path only |
| `api/health` | liveness |
| `api/messaging/webchat/widget`, `projects/[id]/leads/widget`, `reviews/widget` | static scripts embedding one project id |
| `api/projects/[id]/forms/submit` | visitor submission, rate limited, active project only |
| cron / outreach / social routes | `hasBearerSecret(CRON_SECRET)` (tested), unsubscribe uses HMAC token |
| webhooks (stripe, meta, sms, whatsapp, investor-hub, investor-voice) | signature verification (per-account for sms/whatsapp/meta) |

## Route audit

| Route(s) | Resource | Guard | Verdict |
|----------|----------|-------|---------|
| `cron/*` (19), `outreach/*`, `social/*` | system jobs | `hasBearerSecret` (fail-closed) / HMAC (`unsubscribe`) | OK |
| `webhooks/stripe` | billing events | `constructEvent` signature + idempotent claim | OK |
| `webhooks/meta`, `sms`, `whatsapp`, `investor-hub/sms`, `investor-voice/*` | inbound messages | provider signature, resolved per account | OK |
| `projects/[id]/{bookings,leads,leads/widget,reviews,reviews/widget,support,forms/submit}`, `messaging/webchat/[projectId]` | public project data | `findPublicProject` / active-project check + rate limit; touches only that project; webchat visitor id is an unguessable bearer | OK |
| `projects/[id]/agent` | agent conversation | session + `getAuthorizedProject` + conversation scoped to project | **Fixed (#1)** |
| `projects/[id]/agent/sync`, `agent/tool-calls/[id]/decision`, checkpoints | agent data | session + `getAccessibleProject` / `conversation: { projectId }` / `findFirst({ id, projectId })` | OK |
| `projects/[id]/calendar` | calendar connection | session + `projectOwnerAccessOr` | **Fixed (#2)** |
| `projects/[id]/**` (files, deploy, secrets, analytics, hosting…) | project data | `requireProjectAccess` / `getAccessibleProject` | OK |
| investor-hub routes | investor ids | `requireProjectAccess` + `scope(ctx)` (user + project) | OK |
| preview / live | deployments | `authorizePreviewAccess` (member, admin with `observatory:read`, or public/workspace live) | OK |
| staging | staging deployment | `authorizeStagingAccess` (member or share token) | OK |
| video, video-release | user videos | session + `userId` scoping | OK |
| `domains/resolve`, `health`, `auth/[...all]`, `cli/device/*` | public | see allowlist | OK |

## Server actions

| Action file(s) | Resource | Guard | Verdict |
|----------------|----------|-------|---------|
| `lib/actions/*` (projects, leads, posts, experiments, reviews, inbox, publish, staging, domains…) | per-project data | `getAccessibleProject` / `projectAccessWhere` / `ownedLead` / `ownedPost` / `ownedExperiment` / `ownedReview` / `userId` | OK |
| `lib/actions/marketing-credits.ts` | wallet, project budgets | `requireUser`; budgets add `hasProjectAccess` | **Fixed (#3)** |
| `lib/actions/calendar.ts`, `meetings.ts` | calendar, meeting requests | `projectOwnerAccessOr` | **Fixed (#2)** |
| `lib/actions/meeting-public.ts` | guest meeting | HMAC token + `tokenVersion` + participant email | OK (public) |
| `lib/agents/project-actions.ts`, `lib/content-pipeline/actions.ts` | agent settings, pipelines | `requireProjectOwner` via `projectOwnerAccessOr` | **Fixed (#2)** |
| `lib/admin/actions/*` (16) | platform admin | `requireAdmin(permission)` | OK |
| `lib/feedback/actions.ts` | feedback | session | OK |
| `lib/sales/actions.ts` | sales enquiries | public submission, rate limited | OK (public) |
| `lib/auth/actions.ts` | auth | `resolvePasswordResetReminderAction(email)` is unauthenticated but only cancels pending reminders | OK (low risk) |

## Pages

Dynamic pages under `app/app/projects/[workspaceSlug]/[projectSlug]/*` and `app/(dashboard)/*` resolve the project through `getAccessibleProject` / `projectAccessWhere` (owner-only pages through `projectOwnerAccessOr`). `p/…/staging` uses `authorizeStagingAccess`. `meeting/[token]` relies on the HMAC meeting token. Not read line-by-line: `app/book/[projectId]` (public booking, scoped by project via `bookings` route).

## Stale creator pattern deliberately left

`lib/domains/custom-domain.ts`, `lib/actions/staging.ts`, `lib/actions/publish.ts` use creator-or-owner only to count the user's own private deployments for plan limits. This is not authorisation.

## Needs a human decision

1. `resolveBillingContext` lets any admin role act on any project, billing the workspace owner's wallet. Intended for support?
2. `remixProjectAction` copies source files of any project with a live PUBLIC deployment (source, not only built output).
3. `project-marketing/connect` accepts `?project=` as a redirect `returnTo` without an access check (low risk).
4. Inbox / agents / content-pipeline pages are owner-only while inbox actions allow all members (inconsistent, not a leak).
5. The lead widget builds JS by inlining `JSON.stringify(projectId)`; negligible risk but could be hardened.
6. `app/book/[projectId]` and `meeting/[token]` pages were reviewed at a high level only.

## Tests

- `lib/security/tenant-guard.test.ts`: fails if a `route.ts` or `lib/actions` file lacks a recognised guard and is not allowlisted; checks the allowlist for stale/unjustified entries; asserts every cron/outreach/social route calls `hasBearerSecret`.
- `lib/projects/tenant-isolation.integration.test.ts`: two tenants with projects, leads, conversations, messages, media, wallets/ledger, calendar connections, meetings, secrets and agent settings; asserts A cannot read, modify or spend B's via the real route handlers/actions and access helpers, plus regressions for the three fixes.
