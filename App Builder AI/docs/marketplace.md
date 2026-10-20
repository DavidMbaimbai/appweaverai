# Template and component marketplace

Users discover and install templates, components, integration setup guides, agent workflows and starter kits. Creators publish assets and can optionally sell them.

Routes: `/marketplace` (public browse), `/marketplace/<type>` (templates, components, integrations, workflows, starter-kits), `/marketplace/<type>/<slug>` (detail), `/marketplace/creator` (signed in), `/admin/marketplace` (`marketplace:read`/`marketplace:write`).

Code: `lib/marketplace/*` (logic), `lib/actions/marketplace.ts` (user actions), `lib/admin/actions/marketplace.ts` (moderation). Existing website templates (`WebsiteTemplate`, `lib/actions/templates.ts`) and the integration catalogue (`lib/integrations`) are separate and untouched; integration assets only link to catalogue ids.

## Real vs blocked

| Area | Status |
| --- | --- |
| Browse, search, filter, sort, detail, licence display | Real |
| Install into a project (validated, conflict list first, never overwrites, versioned, project memory + audit log) | Real |
| Creator submission, safety scan, admin moderation, takedown and reports | Real |
| Reviews (installers/purchasers only, one per user) | Real. Counts and ratings are computed from stored rows only |
| First-party free assets | Real; published by an admin with the "Publish first-party free assets" button (idempotent) |
| Paid assets via Stripe Checkout | Implemented, **disabled by default** (see env vars) |
| Creator earnings ledger, refund reversals | Real |
| **Creator payouts** | **Blocked: needs Stripe Connect configuration.** Earnings accrue in the ledger; nothing is ever transferred |
| Disputes / chargebacks | Not handled (open decision) |

## Environment variables

- `MARKETPLACE_PAID_SALES_ENABLED` (default off). Paid listings and checkout work only when this is `true`, a fee is configured and Stripe is configured.
- `MARKETPLACE_PLATFORM_FEE_PERCENT`: **placeholder, no default.** The final fee is a business decision. Unset or invalid keeps paid sales blocked. The fee is frozen on each order at checkout.
- `MARKETPLACE_TAKEDOWN_EMAIL`: DMCA / takedown contact shown on asset pages. Placeholder until the owner supplies one.
- `MARKETPLACE_MAX_SUBMISSIONS_PER_DAY` (default 5).

## Safety model

- Bundles are JSON: text files only, extension allowlist, no executables, no `.env`, no traversal/absolute/backslash/reserved paths, size and file-count limits (`LIMITS` in `types.ts`).
- Every submission is scanned with the `lib/code-scan` scanners plus marketplace malware/injection rules. Secrets or HIGH/CRITICAL findings block the submission; a blocked version can never be approved. The scan is deterministic (no AI), so no prompt-injection surface.
- Content is re-validated and checksum-checked at install time. Versions are immutable (database trigger).
- Install never overwrites: conflicts are listed first; the user may skip conflicting files.
- Abuse controls: per-user rate limits on every action, daily submission cap, pending and total asset caps, report rate limit.

## Money

- Checkout creates a `PENDING` order; the existing Stripe webhook (`checkout.session.completed`, metadata `kind=marketplace_asset`) claims it with a conditional update and writes one idempotent `EARNING` ledger line. `charge.refunded` writes pro-rata `REFUND_REVERSAL` lines (cumulative, capped, idempotent).
- Stripe processing fees are borne by the platform; the fee is taken on the gross amount (open decision).

## Open decisions

1. Final platform fee percent.
2. First-party licence (MIT is a placeholder).
3. Stripe Connect onboarding and payout schedule.
4. Dispute handling and takedown contact (DMCA process).
5. Metadata editing (new versions only today), review moderation UI, sitemap entries, privacy-erasure handling for marketplace rows (orders must be retained for finance).
