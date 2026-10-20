# AppWeaver AI

**AppWeaver AI** is an AI-powered app builder — describe what you want to build in plain language, and an AI agent scaffolds, writes, and iterates on a real, running project for you. This repository is an **MVP (Minimum Viable Product)**: it demonstrates the core end-to-end experience (prompt → generated app → live preview) rather than a fully hardened, production-ready platform.

## What it does

- **Prompt-to-app generation** — Describe an idea on the home screen and the AI agent turns it into a working project.
- **Agent-driven editor** — A chat-style agent panel writes and edits code, streams file changes, and explains its actions step by step.
- **Live preview** — Generated projects render in an in-browser preview panel so you can see changes as they happen.
- **Project workspace** — Save, browse, and manage multiple projects from a personal dashboard, with a trash/restore flow.
- **Authentication & billing scaffolding** — Email/password and OAuth (Google, GitHub) sign-in via Better Auth, plus a billing/entitlements layer (Stripe) for tiered plans.
- **Marketing site** — A landing page with hero, feature highlights, platform overview, pricing, and testimonials sections.

## Tech stack

- [Next.js](https://nextjs.org) (App Router) + React 19 + TypeScript
- Tailwind CSS 4
- Prisma ORM + PostgreSQL (`@prisma/adapter-pg`)
- [Better Auth](https://www.better-auth.com/) for authentication
- Anthropic SDK for the AI coding agent
- Stripe for billing

## MVP status & limitations

This is an early-stage MVP intended to validate the core product experience. Expect the following:

- Some features are scaffolded but not fully wired to production services (e.g. billing, OAuth providers require your own API keys).
- Error handling, test coverage, and performance tuning are minimal.
- The AI agent's output quality depends on the underlying model and prompt design, and is still evolving.
- Project marketing: Instagram publishing (image posts via the Facebook Graph API) and Facebook Page choice need Meta app review (`instagram_basic`, `instagram_content_publish`); see `.env.example`.
- Investor Hub: daily follow-up digest cron (`/api/cron/investor-reminders`), manual call logging, and consent-gated Twilio SMS (dry-run until `TWILIO_*` is set; inbound STOP via `/api/investor-hub/sms`). Calls are never auto-dialled.
- Reviews: per-project CSV export (`/api/projects/<id>/reviews/export`) and a delete-all-data control on the Reviews page.
- Deleting a project permanently also removes its marketing campaigns/posts and Investor Hub data (plus social connections when no campaigns remain).
- Staging: each project has one live STAGING and one live PRODUCTION deployment (`Deployment.environment`; a DB partial unique index enforces it). Staging is served at `<slug>--staging.<APP_ROOT_DOMAIN>` (needs the same wildcard DNS/cert as project subdomains; `--staging` labels are reserved) with a path fallback at `/p/<workspace>/<project>/staging`. It always sends `X-Robots-Tag: noindex`, and is protected by a random share token (`?token=` sets a cookie) unless the owner opens it. "Promote" copies the exact staged files to production (new version, `promotedFromVersion`), with no rebuild. Rollback is per environment. `isCurrent` keeps meaning "current production"; the live staging row is the STAGING row with status LIVE.

## Getting Started

### Prerequisites

- Node.js and npm
- A PostgreSQL database (set `DATABASE_URL`)
- An AWS account with Bedrock access to Anthropic Claude models (`AWS_REGION`, plus AWS credentials)
- (Optional) Google/GitHub OAuth credentials and a Stripe key for billing features

### Install & run

```bash
npm install
npx prisma generate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the app.

### Environment variables

Create a `.env` file in the project root with at least:

```bash
DATABASE_URL=postgres://...
BETTER_AUTH_URL=http://localhost:3000
# Amazon Bedrock (the only AI provider):
AWS_REGION=eu-north-1
# AWS_ACCESS_KEY_ID=...
# AWS_SECRET_ACCESS_KEY=...
# BEDROCK_MODEL_ID=eu.anthropic.claude-sonnet-4-5-20250929-v1:0
# Optional:
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=whsec_...

# Stripe recurring Price IDs used by pricing page checkout buttons:
STRIPE_BUILDER_MONTHLY_PRICE_ID=price_...
STRIPE_BUILDER_YEARLY_PRICE_ID=price_...
STRIPE_PRO_MONTHLY_PRICE_ID=price_...
STRIPE_PRO_YEARLY_PRICE_ID=price_...
STRIPE_BUSINESS_MONTHLY_PRICE_ID=price_...
STRIPE_BUSINESS_YEARLY_PRICE_ID=price_...
```

For Stripe, create recurring monthly and yearly prices for the Builder, Pro,
and Business products in your Stripe dashboard. Set `STRIPE_SECRET_KEY` to your
server-side API key, `STRIPE_WEBHOOK_SECRET` to the webhook endpoint signing
secret, and `BETTER_AUTH_URL` or `NEXT_PUBLIC_APP_URL` to the deployed app URL
used for checkout success, cancel, and billing portal return URLs. For local
development, use `http://localhost:3000`.

The Stripe webhook endpoint for this app is:

```text
https://YOUR_DOMAIN/api/webhooks/stripe
```

Listen for `checkout.session.completed`, `invoice.paid`,
`customer.subscription.updated`, and `customer.subscription.deleted`.
`checkout.session.completed` sends the "you're subscribed" welcome email,
`invoice.paid` sends a receipt email for every successful charge (first
payment and renewals alike) — both must be enabled on the webhook endpoint
for billing emails to go out.

You can start editing the app by modifying files under `app/` and `components/`. Pages auto-update as you edit.

### Unified inbox

`lib/messaging` is a common messaging layer (web chat, email, WhatsApp, SMS, Messenger, Instagram) with one adapter per
channel, idempotent inbound handling, consent and 24h-window checks before every outbound message, and an autonomous
response pipeline (`respond.ts`) that routes through the agent policy (`decide()`): Assist drafts, Approval queues,
Autonomous sends only owner-allowed low-risk categories with a verified answer. Reviews and sensitive topics (refund, legal,
security, payment, account changes, commitments) are never auto-sent. Owner UI: project → Inbox; admin UI: `/admin/inbox`
(`inbox:read` / `inbox:write`). Env names and webhook URLs are in `.env.example`.

## Learn More

To learn more about the underlying framework, take a look at:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

## Deploy

The easiest way to deploy this app is on the [Vercel Platform](https://vercel.com/new) (from the creators of Next.js). See the [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for details. Make sure your database and environment variables are configured for the target environment.

### Hosting: subdomains, custom domains, SSL

- **Managed subdomains** (`<name>.APP_ROOT_DOMAIN`, default `appweaverai.com`) are routed by `proxy.ts`. You must add a wildcard DNS record (`*.appweaverai.com`) and a wildcard domain on the Vercel project (wildcards on Vercel require using Vercel's nameservers for the domain). Reserved names (www, app, api, admin, mail, …) are blocked.
- **Custom domains** are verified with a DNS TXT record. SSL certificates are issued automatically by Vercel once the domain is attached to the Vercel project. If `VERCEL_API_TOKEN` and `VERCEL_PROJECT_ID` (and `VERCEL_TEAM_ID` for teams) are set, the app attaches the domain through the Vercel Domains API when the user verifies it; otherwise the operator must add the domain under Vercel → Project → Settings → Domains manually. The editor says so explicitly.
- Plan limits live in `lib/hosting/limits.ts` (custom domains, deployments retained, environment variables). Deployment files for rollback are stored on local disk under `.published-versions`, like the live `.published` snapshots.
- Environment variables exist per environment (Development, Staging, Production); staging deployments use the Staging set. Health checks run on demand (no continuous monitoring).
- Launch readiness (`lib/launch-readiness/*`, page `/app/projects/<ws>/<project>/launch`): checks report PASS/WARN/FAIL/NOT_VERIFIED with evidence, stored as `LaunchReport`. It never claims a site is production-ready, only "no blocking issues found in verified checks". Payment integrations are always NOT_VERIFIED (test the flow in the provider's test mode). Publishing to production is blocked only on FAIL (missing index.html, secrets in files, forms without a privacy page, confirmed HTTPS/smoke failures); warnings are surfaced. Owners approve launch (warnings need explicit acknowledgement). Privacy/terms drafts are AI-generated, written to editable files, and are not legal advice.

