# Team collaboration

All logic lives in `lib/team/*`; `lib/team/permissions.ts` is the single source of truth for the role/capability matrix.

- **Roles**: OWNER, ADMIN, DEVELOPER, DESIGNER, MARKETER, BUSINESS_PARTNER, VIEWER. Legacy `WorkspaceRole`/`ProjectRole` rows remain the membership gate; `TeamRoleAssignment` refines them. Legacy MEMBER/EDITOR/PUBLISHER map to DEVELOPER so existing members keep their access; GUEST/VIEWER map to VIEWER.
- **Enforcement**: `requireProjectCapability` / `requireWorkspaceCapability` (`lib/team/access.ts`), `denyWithoutCapability` for routes (`lib/team/http.ts`). Wired into publish/unpublish, env vars (view_secrets/manage_env_vars), custom-domain POST, and the agent route (run_agent).
- **Invitations**: HMAC-signed, 7-day tokens (`TEAM_INVITE_SECRET` or `BETTER_AUTH_SECRET`); resend bumps `tokenVersion` (old link dies); seat limits via `TEAM_SEATS_FREE` / `TEAM_SEATS_PRO` (defaults 2 / 10).
- **Billing**: `resolveBillingContext` is unchanged; the wallet follows `Workspace.ownerId`. Marketing spend is attributed per member via `WorkspaceUsageEvent`, and `MemberSpendLimit` is enforced in `withMarketingCredits` (failure reason `member_limit`). Dev credits are per user (`CreditLedger`); caps there belong to `CreditSpendLimit`.
- **Tenant isolation**: every `lib/team` read/write resolves the caller's role through the project/workspace first; cross-tenant ids return not-found. Nothing was added to the tenant-guard allowlist.
