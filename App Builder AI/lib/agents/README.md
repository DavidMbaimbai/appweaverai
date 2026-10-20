# Agent orchestration core

Shared layer that every agent feature (inbox, daily content pipeline, outreach, voice) plugs into.
Import from `@/lib/agents` (barrel) or the individual files.

## Concepts

- **Scope**: `{ type: 'PLATFORM' }` (AppWeaver's own growth) or `{ type: 'PROJECT', projectId }`.
- **Agents**: `MARKETING_DIRECTOR, CONTENT, SOCIAL_MANAGER, CUSTOMER_ENGAGEMENT, INVESTOR, VOICE_MESSAGING, GROWTH_ANALYST`.
- **Modes** (per scope + agent, default **disabled / ASSIST**):
  - `ASSIST` – only drafts (`DRAFT_ONLY`, activity `PLANNED`).
  - `APPROVAL` – queues every action (`NEEDS_APPROVAL`, activity `AWAITING_APPROVAL`).
  - `AUTONOMOUS` – runs actions whose `category` the owner allowed, within daily limits. Needs a stored explicit authorisation (who/when).
- **High-risk kinds** (`refund, binding_commitment, permission_change, paid_spend, first_outbound_campaign, sensitive_data_change`) never `EXECUTE` in any mode; they run only through `approveActivity`.
- Review replies on the PLATFORM scope are always `DRAFT_ONLY`.
- Kill switches: `GLOBAL` (everything) and `PLATFORM` (platform automations); per-agent `paused`.

## Running an action

```ts
import { runAgentAction, registerAgentExecutor } from '@/lib/agents';

// Optional: lets approvals/retries (separate requests) run the action.
registerAgentExecutor('social.reply.send', async ({ payload }) => {
  await send(payload);
  return { summary: 'Reply sent', costCents: 0 };
});

const result = await runAgentAction({
  scope: { type: 'PROJECT', projectId },
  agent: 'CUSTOMER_ENGAGEMENT',
  action: 'social.reply.send',
  category: 'customer_reply',
  kinds: [],                 // e.g. ['paid_spend'] forces approval
  input: 'Reply to @bob',    // redacted + truncated before storage
  payload: { interactionId }, // non-secret data for the executor
  sources: [{ url }],
  idempotencyKey: `reply:${interactionId}`,
  execute: async () => ({ summary: 'Reply sent' }), // runs only on EXECUTE
});
// result.status: DONE | FAILED | AWAITING_APPROVAL | PLANNED | BLOCKED | RUNNING
```

- Every call writes an `AgentActivity` row first and updates it afterwards.
- If outcome is `EXECUTE` and no executor exists, status is `RUNNING`; call `completeActivity(id, { summary | error })`.
- Approved activities with no registered executor become `PLANNED` with `decidedBy` set; the owning feature picks them up.
- `credits?: CreditsHook` is an optional hook (see `lib/credits`) that is called after success and records `creditsCharged`; nothing here depends on the ledger.
- `approveActivity / rejectActivity / pauseActivity / retryActivity(id, actorId?, scope?)` back the UI. Pass `scope` to restrict a project owner to their project. Callers must authorise the actor first.

## Existing automations

`isAgentPaused(agent?)` (`pause.ts`) is the single check used by platform crons (social-post, ads, social-replies, investor-reminders). It only reflects the kill switches and the platform agent's `paused` flag, so behaviour is unchanged until an admin pauses. It fails open if the database is unavailable.

## Untrusted content (`untrusted.ts`)

Use `buildUntrustedCall({ system, task, untrusted: [{ label, content, redact }] })` for any model call that includes customer messages, emails, reviews or web content. It prepends `UNTRUSTED_SYSTEM_PREAMBLE`, neutralises instruction-like text, wraps content in nonce-delimited blocks and returns `flags`; when `flags` is non-empty prefer approval. `redactSensitive()` masks emails, phones, keys and tokens (use before logging or storing).

## UI

- Admin: `/admin/command-centre` (`commandcentre:read` / `commandcentre:write`).
- Project owner: `/app/projects/[ws]/[proj]/agents`.
- Metrics that cannot be read are `null` and shown as "not available".
