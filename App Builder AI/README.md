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

## Getting Started

### Prerequisites

- Node.js and npm
- A PostgreSQL database (set `DATABASE_URL`)
- An Anthropic API key for the agent (`ANTHROPIC_API_KEY`)
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
ANTHROPIC_API_KEY=...
BETTER_AUTH_URL=http://localhost:3000
# Optional:
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
STRIPE_SECRET_KEY=...
```

You can start editing the app by modifying files under `app/` and `components/`. Pages auto-update as you edit.

## Learn More

To learn more about the underlying framework, take a look at:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

## Deploy

The easiest way to deploy this app is on the [Vercel Platform](https://vercel.com/new) (from the creators of Next.js). See the [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for details. Make sure your database and environment variables are configured for the target environment.

