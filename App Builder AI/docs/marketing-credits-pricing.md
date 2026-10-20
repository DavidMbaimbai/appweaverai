# Marketing credits: pricing and policy defaults

> **Status: UNAPPROVED ASSUMPTIONS.** Every value below is an engineering default awaiting product-owner confirmation.
> Until an admin approves the catalogue (Admin → Marketing pricing → "Mark current catalogue approved"), customers cannot
> buy credit packages unless `MARKETING_CREDITS_ALLOW_UNAPPROVED=true`. Approval records who and when, and is voided by
> any later price-version or package change.

Marketing credits are separate from build credits. Ad spend, carrier and provider fees are not credits, except the
explicit passthrough items (SMS, WhatsApp, voice), which are priced at provider cost plus margin.

## Value assumptions

- 1 credit is about 1.5 US cents; passthrough margin is 20% over provider cost.
- Video uses Nova Reel at `VIDEO_NOVA_REEL_CENTS_PER_SECOND` (default 8 cents) with the build-credits video margin.

## Default prices (credits)

| Operation | Credits | Max factor | Billable |
| --- | --- | --- | --- |
| text_post | 3 | 1 | yes |
| campaign_draft | 8 | 1 | yes |
| ad_pack | 8 | 1 | yes |
| image | 8 | 1 | yes |
| customer_ad | 15 | 1 | yes |
| video_per_second | from `videoCreditsPerSecond()` per second | 1 | yes |
| translation / subtitles | 2 per language | 1 | yes |
| engagement_reply | 1 | 1 | yes |
| growth_draft | 6 | 1 | yes |
| lead_followup | 2 | 1 | yes |
| sms | 1 per 160-char segment (cost 1c +20%) | 1.25 | yes |
| whatsapp | 2 per message (cost 1.5c +20%) | 1.25 | yes |
| voice_minute | 2 per minute (cost 2c +20%) | 1.25 | yes |
| schedule_post, publish_post, lead_reminder, campaign_send | 0 | 1 | no (free) |

Subtitles generation is local (no provider cost) so it has no metered call site; the price exists for the catalogue only.

## Packages (Stripe one-off Checkout)

| Package | Credits | Price |
| --- | --- | --- |
| Starter 500 | 500 | $9.00 |
| Growth 2,000 | 2,000 | $29.00 |
| Scale 10,000 | 10,000 | $129.00 |

Credits are granted only from the verified Stripe webhook, idempotent on session and payment intent.

## Free-plan trial allowance

Default **0 (disabled)**. Configurable in the admin pricing page, with `FREE_PLAN_MARKETING_CREDITS`,
`FREE_PLAN_MARKETING_CREDITS_MODE` (`ONCE` or `MONTHLY`) and `FREE_PLAN_MARKETING_CREDITS_EXPIRY_DAYS` (default 30) as env
fallback. Granted as PROMO credits, one grant per user (or per user and UTC month), only to free-plan customers and never
to internal scope.

## Thresholds, TTL and rules

- Reservation TTL: 30 minutes; a cron releases stale reservations.
- Low-balance email threshold: 50 credits (`MARKETING_LOW_BALANCE_THRESHOLD`, per-wallet override).
- Budget near-limit warning: 80% of a day/week/month limit (`MARKETING_BUDGET_WARN_PERCENT`), once per period.
- Refunds: a failed operation is refunded in full; a duplicate or retried idempotency key never double-charges; unused
  reservation is released on settle; actual usage is capped at the reserved maximum.
- Promo credit expiry: set per grant; expired lots are removed by the cron and recorded in the ledger.
- Scheduling and publishing are free by default.
- Scheduled jobs pause when a project limit or the balance is reached, and resume when both allow it.
- Internal (AppWeaver) scope charges zero customer credits and logs an estimated internal cost.
- Kill switch: `MARKETING_CREDITS_ENABLED=false`.
