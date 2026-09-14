# AppWeaver AI — Admin Console Product Backlog & Implementation Tickets

> Source: AppWeaver_AI_Admin_Console_Tickets.docx
> Implementation-ready epics, user stories, acceptance criteria, dependencies, priorities, and release guidance for the AppWeaver AI Admin Console.

## Purpose

This backlog converts the AppWeaver AI Admin Console requirements into implementation-ready tickets suitable for Jira, Linear, Azure DevOps, or sprint planning. It covers administration, users, projects, payments, subscriptions, analytics, AI cost control, system health, security, auditability, alerts, and settings.

Recommended delivery model: **Release 1 (MVP)** establishes secure administration and the operational dashboards. **Release 2 (Growth)** adds deeper analytics, profitability controls, automation, and advanced operational tooling. **Release 3 (Optimization)** adds optimization, forecasting, and extended governance.

## Release Summary

| Release | Primary Goal | Typical Tickets | Outcome |
|---|---|---|---|
| Release 1 — MVP | Operate the platform safely | RBAC, dashboard, users, projects, payments, subscriptions, AI usage, health, audit | Admin team can run day-to-day operations |
| Release 2 — Growth | Understand growth and unit economics | Funnels, cohorts, trends, profitability, alerts, provider analytics | Leadership can optimize growth, cost, and retention |
| Release 3 — Optimization | Automate governance and forecasting | Forecasting, anomaly detection, advanced security, export/reporting | Proactive operations and business intelligence |

## EPIC 1 — Admin Foundation, Authentication & RBAC

Create a secure administration surface that is isolated from normal user functionality and protected with granular permissions.

### ADM-001 — Create dedicated Admin Console shell

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 3 pts | None |

**User Story:** As an administrator, I want a dedicated admin interface so that operational tools are separated from the customer product.

**Description:** Create the /admin application shell, navigation, protected layout, route guards, error states, and shared admin components.

**Acceptance Criteria:**
- Only authenticated users with an authorized admin role can access /admin routes.
- Unauthorized users are redirected or shown an access-denied page.
- Navigation includes Dashboard, Users, Projects, Subscriptions, Payments, AI Usage, Analytics, System Health, Security, Audit Logs, Alerts, Promotions, and Settings.
- The layout is responsive and usable on standard desktop and tablet sizes.
- Technical Notes: Prefer a distinct admin layout and route namespace. Do not reuse customer navigation.

### ADM-002 — Define admin roles and permissions

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 5 pts | ADM-001 |

**User Story:** As a platform owner, I want role-based permissions so that staff only access the tools needed for their job.

**Description:** Define SUPER_ADMIN, ADMIN, FINANCE_ADMIN, SUPPORT_ADMIN, ANALYTICS_VIEWER, and SECURITY_ADMIN roles with granular permissions.

**Acceptance Criteria:**
- Each role has an explicit permission matrix.
- Backend authorization checks are enforced in addition to frontend route guards.
- Permissions cover read, create, update, suspend, refund, export, and configuration actions as applicable.
- SUPER_ADMIN has full access; ANALYTICS_VIEWER is read-only.
- Technical Notes: Use server-side authorization annotations/policies. Never rely only on hidden UI controls.

### ADM-003 — Admin authentication and session controls

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 5 pts | ADM-002 |

**User Story:** As an administrator, I want secure login and session handling so that privileged access is protected.

**Description:** Implement admin login enforcement, session timeout, re-authentication for sensitive actions, and session revocation.

**Acceptance Criteria:**
- Admin sessions expire after a configurable inactivity period.
- Sensitive actions such as refunds, role changes, or bans can require recent authentication.
- Revoked or disabled admin accounts lose access immediately.
- Failed admin logins are recorded as security events.

### ADM-004 — Admin profile and permission viewer

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 1 — MVP | 2 pts | ADM-002 |

**User Story:** As an administrator, I want to see my assigned role and permissions so that I understand what I can do.

**Description:** Add a profile panel showing identity, roles, permissions, last login, and active sessions.

**Acceptance Criteria:**
- Admin can view assigned roles and effective permissions.
- Last successful login and recent sessions are visible.
- No secrets or authentication tokens are displayed.

### ADM-005 — Audit every privileged admin action

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 5 pts | ADM-002 |

**User Story:** As a security owner, I want all privileged actions audited so that changes are traceable.

**Description:** Add a reusable audit interceptor/service for admin actions.

**Acceptance Criteria:**
- Audit records include admin, action, target resource, timestamp, result, and request correlation ID.
- Before/after values are recorded for mutable business fields where practical.
- Failed privileged actions are audited.
- Audit events cannot be modified through normal admin APIs.

## EPIC 2 — Dashboard & Executive Overview

Provide a single operational dashboard for users, revenue, projects, AI cost, subscriptions, and platform health.

### ADM-010 — Dashboard KPI API

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 8 pts | ADM-002 |

**User Story:** As an administrator, I want consolidated platform KPIs so that I can understand the current state of the business.

**Description:** Create backend aggregation endpoints for user, revenue, subscription, project, AI usage, and health KPIs.

**Acceptance Criteria:**
- API returns total users, DAU, WAU, MAU, new users, paying users, MRR, ARR, projects, AI requests, token use, AI cost, and key health status.
- Metrics support a requested date range.
- Queries are performant for production-scale data.
- Metric definitions are documented and deterministic.

### ADM-011 — Dashboard KPI cards

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 5 pts | ADM-010 |

**User Story:** As an administrator, I want KPI cards so that critical metrics are visible at a glance.

**Description:** Build dashboard cards for users, revenue, subscriptions, projects, AI usage, and system health.

**Acceptance Criteria:**
- Cards display current value and comparison to the previous equivalent period.
- Loading, empty, and error states are handled.
- Values use appropriate number and currency formatting.

### ADM-012 — Dashboard date-range filtering

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 3 pts | ADM-010, ADM-011 |

**User Story:** As an administrator, I want to filter dashboard metrics by period so that I can compare performance over time.

**Description:** Add Today, 7 days, 30 days, 90 days, month, year, and custom range filters.

**Acceptance Criteria:**
- All dashboard widgets update consistently from one selected date range.
- Custom date ranges validate start/end dates.
- Selected range persists during the admin session.

### ADM-013 — Dashboard trend charts

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 1 — MVP | 5 pts | ADM-012 |

**User Story:** As an administrator, I want visual trends so that growth and anomalies are easier to identify.

**Description:** Create charts for users, revenue, project creation, AI usage, and subscriptions.

**Acceptance Criteria:**
- Charts show time-series values for the selected dashboard range.
- Tooltips show exact values and dates.
- No-data periods are represented correctly instead of being silently omitted.

### ADM-014 — Dashboard system-status panel

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 1 — MVP | 3 pts | ADM-010 |

**User Story:** As an administrator, I want a system-status summary so that I can immediately see degraded services.

**Description:** Display API, database, AI providers, payment provider, and deployment service status.

**Acceptance Criteria:**
- Services show healthy, degraded, or unavailable states.
- Critical incidents are visually distinguishable.
- A link opens the detailed System Health page.

## EPIC 3 — User Management

Give support and operations staff full visibility and controlled actions over customer accounts.

### ADM-020 — User search and listing

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 5 pts | ADM-002 |

**User Story:** As a support administrator, I want to search and filter users so that I can quickly find accounts.

**Description:** Create paginated user listing with search and filters.

**Acceptance Criteria:**
- Search supports user ID, name, and email.
- Filters include account status, subscription plan, verification status, signup date, and role.
- List shows status, plan, created date, last login, and recent usage summary.
- Pagination and sorting work on the server side.

### ADM-021 — User profile detail view

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 5 pts | ADM-020 |

**User Story:** As a support administrator, I want a complete user profile so that I can investigate account issues.

**Description:** Create a user detail page with account, billing, usage, project, login, and support information.

**Acceptance Criteria:**
- Profile shows identity, account status, verification state, plan, billing state, created date, and last login.
- Profile includes project count, AI usage, credits used/remaining, and payment summary.
- Sensitive payment data is masked and access-controlled.

### ADM-022 — Suspend and reactivate user accounts

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 5 pts | ADM-021, ADM-005 |

**User Story:** As an administrator, I want to suspend abusive or risky accounts so that the platform can be protected.

**Description:** Implement suspension/reactivation with reason capture.

**Acceptance Criteria:**
- Suspension requires a reason.
- Suspended users cannot perform protected platform actions.
- Reactivation restores permitted access.
- Both actions are audited and visible in account history.

### ADM-023 — Disable and ban accounts

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 1 — MVP | 5 pts | ADM-022 |

**User Story:** As a security administrator, I want to disable or ban accounts so that severe abuse can be contained.

**Description:** Implement disabled and banned states separately from temporary suspension.

**Acceptance Criteria:**
- Disable and ban actions require confirmation and reason.
- Banned accounts cannot authenticate.
- Status changes propagate immediately.
- All actions are auditable.

### ADM-024 — Manage user roles

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 1 — MVP | 3 pts | ADM-002, ADM-021 |

**User Story:** As a super administrator, I want to assign roles so that access can be administered centrally.

**Description:** Add controlled role assignment/removal.

**Acceptance Criteria:**
- Only authorized admins can change roles.
- Role changes are validated against allowed role combinations.
- Role changes take effect without requiring database intervention.
- Changes are audited.

### ADM-025 — Reset or grant usage credits

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 1 — MVP | 3 pts | ADM-021, ADM-005 |

**User Story:** As a support administrator, I want to adjust credits so that service issues or promotions can be resolved quickly.

**Description:** Allow authorized staff to grant credits or reset usage limits.

**Acceptance Criteria:**
- Admin must enter adjustment amount and reason.
- Adjustments cannot create invalid negative balances.
- Credit changes are immediately reflected to the user.
- Adjustment history is retained and auditable.

### ADM-026 — User login and activity history

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 2 — Growth | 5 pts | ADM-021 |

**User Story:** As a security administrator, I want account activity history so that suspicious behavior can be investigated.

**Description:** Display login attempts, sessions, devices, IP metadata, and important account actions.

**Acceptance Criteria:**
- History is ordered and filterable by event type and date.
- Successful and failed login attempts are distinguishable.
- Sensitive network data is only visible to roles with appropriate permission.

### ADM-027 — Flag users for review

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P2 | Release 2 — Growth | 3 pts | ADM-021 |

**User Story:** As an administrator, I want to flag accounts so that risky users can be reviewed without immediately blocking them.

**Description:** Add internal flags, reason, severity, and review status.

**Acceptance Criteria:**
- Flags support open, investigating, resolved, and dismissed states.
- Flagged users appear in a dedicated filter/view.
- Flag history is retained.

## EPIC 4 — Payments, Billing & Subscription Administration

Give finance staff end-to-end visibility and controlled actions for revenue, transactions, invoices, plans, and subscription lifecycle.

### ADM-030 — Payment transaction listing

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 5 pts | ADM-002 |

**User Story:** As a finance administrator, I want to view all transactions so that payment issues can be reconciled.

**Description:** Create transaction list with provider, customer, amount, currency, status, and timestamps.

**Acceptance Criteria:**
- Filters include success, failed, pending, refunded, date range, provider, currency, and customer.
- Provider transaction IDs are searchable.
- Pagination and export-safe formatting are supported.

### ADM-031 — Payment transaction detail

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 3 pts | ADM-030 |

**User Story:** As a finance administrator, I want payment detail so that I can investigate individual transactions.

**Description:** Create transaction detail page with subscription, invoice, provider metadata, and event history.

**Acceptance Criteria:**
- Payment detail includes transaction ID, amount, currency, status, customer, invoice, subscription, and provider reference.
- Raw provider payloads are not exposed unless sanitized.
- Related refunds and payment events are linked.

### ADM-032 — Subscription listing and detail

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 5 pts | ADM-002 |

**User Story:** As a finance administrator, I want to see subscriptions so that plan lifecycle can be managed.

**Description:** Create subscription list and detailed subscription view.

**Acceptance Criteria:**
- List includes plan, customer, status, billing cycle, start/end dates, trial state, and next renewal.
- Detail shows upgrade/downgrade/cancellation history.
- Filters support plan and subscription status.

### ADM-033 — Manual plan change

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 1 — MVP | 5 pts | ADM-032, ADM-005 |

**User Story:** As an authorized administrator, I want to upgrade or downgrade a customer so that support cases can be resolved.

**Description:** Support controlled manual plan transitions.

**Acceptance Criteria:**
- Plan changes validate billing and entitlement rules.
- Admin sees impact before confirming.
- The user entitlements update after a successful change.
- Changes are audited with reason.

### ADM-034 — Extend trial or subscription

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 1 — MVP | 3 pts | ADM-032 |

**User Story:** As a support administrator, I want to extend a trial or subscription so that approved exceptions can be handled.

**Description:** Allow date extension with reason and permission checks.

**Acceptance Criteria:**
- Extension requires an explicit new end date or number of days.
- Invalid past dates are rejected.
- The adjustment appears in subscription history.

### ADM-035 — Refund payment

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 8 pts | ADM-031, ADM-005 |

**User Story:** As a finance administrator, I want to issue refunds so that valid customer requests can be processed.

**Description:** Implement full and partial refunds through the configured payment provider.

**Acceptance Criteria:**
- Refund action is limited to authorized finance roles.
- Admin can select full or partial refund when provider supports it.
- Refund amount cannot exceed refundable balance.
- Provider result is persisted and payment state is reconciled.
- Refund is audited with reason and actor.

### ADM-036 — Revenue KPI service

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 8 pts | ADM-030, ADM-032 |

**User Story:** As a finance administrator, I want revenue metrics so that financial performance is measurable.

**Description:** Compute total revenue, MRR, ARR, ARPU, revenue by plan/provider/country, refunds, and failed payment rate.

**Acceptance Criteria:**
- MRR/ARR definitions are documented and consistently calculated.
- Metrics support date-range filtering.
- Refunded amounts are treated consistently across all dashboards.
- Calculations can be reconciled to payment records.

### ADM-037 — Churn and conversion metrics

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 2 — Growth | 5 pts | ADM-032, ADM-036 |

**User Story:** As a product owner, I want churn and conversion metrics so that subscription performance can be improved.

**Description:** Calculate cancellation rate, churn, trial-to-paid conversion, free-to-paid conversion, and renewal performance.

**Acceptance Criteria:**
- Metric definitions and cohort windows are documented.
- Metrics can be segmented by plan and date.
- Canceled and expired subscriptions are handled distinctly.

### ADM-038 — Coupon and promotion management

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P2 | Release 2 — Growth | 8 pts | ADM-032 |

**User Story:** As a growth administrator, I want to manage promotions so that campaigns can be launched without code changes.

**Description:** Create, activate, expire, and disable coupons/promotional codes.

**Acceptance Criteria:**
- Promotion supports code, discount type/value, validity dates, redemption limit, eligible plans, and status.
- Invalid or expired promotions cannot be redeemed.
- Redemption usage is visible in admin.
- Promotion changes are audited.

## EPIC 5 — Platform Analytics & Trends

Provide product and growth analytics for engagement, retention, feature adoption, geography, devices, and usage patterns.

### ADM-040 — Analytics event taxonomy

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 8 pts | ADM-001 |

**User Story:** As a product owner, I want a consistent event model so that analytics metrics are reliable.

**Description:** Define and instrument core events for signup, prompt, generation, build, deployment, payment, subscription, feature use, and session activity.

**Acceptance Criteria:**
- Event names and required properties are documented.
- Events include user/project identifiers where permitted and correlation IDs where useful.
- Duplicate event ingestion is handled safely.
- PII is minimized and governed.

### ADM-041 — DAU, WAU and MAU analytics

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 5 pts | ADM-040 |

**User Story:** As an administrator, I want active-user metrics so that engagement can be monitored.

**Description:** Create active-user aggregation by day/week/month.

**Acceptance Criteria:**
- Active user definition is documented.
- Metrics support selected date ranges.
- Results can be segmented by plan and country where data exists.

### ADM-042 — User growth and registration trends

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 1 — MVP | 3 pts | ADM-040 |

**User Story:** As a product owner, I want signup trends so that acquisition growth is visible.

**Description:** Chart registrations, cumulative users, and growth rate.

**Acceptance Criteria:**
- Daily/weekly/monthly grouping is supported.
- Growth percentage compares equivalent periods.
- Data respects date filters.

### ADM-043 — Feature adoption analytics

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 2 — Growth | 5 pts | ADM-040 |

**User Story:** As a product owner, I want to know which features users adopt so that roadmap decisions are evidence-based.

**Description:** Measure usage of major AppWeaver features, templates, integrations, frameworks, and deployment options.

**Acceptance Criteria:**
- Features are ranked by unique users and total usage.
- Metrics can be filtered by plan and date.
- Feature definitions map to stable analytics events.

### ADM-044 — Country, device and browser trends

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P2 | Release 2 — Growth | 5 pts | ADM-040 |

**User Story:** As a product owner, I want audience breakdowns so that product and infrastructure decisions can be localized.

**Description:** Aggregate permitted geography, device, OS, and browser metrics.

**Acceptance Criteria:**
- Country/region data is shown only when collection is lawful and configured.
- Device/browser values are normalized into useful categories.
- Unknown values are explicitly represented.

### ADM-045 — Peak usage analysis

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P2 | Release 2 — Growth | 3 pts | ADM-040 |

**User Story:** As an operations owner, I want peak usage periods so that capacity planning can be improved.

**Description:** Calculate busiest hours, days, and request/project-generation periods.

**Acceptance Criteria:**
- Peak periods can be viewed by date range.
- Metrics include active users and request volume.
- Timezone used for aggregation is visible/configurable.

### ADM-046 — Retention cohort analysis

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 2 — Growth | 8 pts | ADM-040, ADM-041 |

**User Story:** As a product owner, I want retention cohorts so that long-term user engagement can be measured.

**Description:** Create signup cohorts and retention by week/month.

**Acceptance Criteria:**
- Cohorts show returning-user percentage over time.
- Retention definition is documented.
- Cohorts can be segmented by plan/source when data is available.

## EPIC 6 — Funnel & Conversion Analytics

Measure the customer journey from visitor and signup through first successful app, deployment, trial, and paid retention.

### ADM-050 — Define conversion funnel stages

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 2 — Growth | 3 pts | ADM-040 |

**User Story:** As a growth owner, I want standardized funnel stages so that conversion metrics are consistent.

**Description:** Define Visitor → Signup → Verification → First Prompt → First Generated App → First Successful Build → First Deployment → Trial → Paid → Retained → Upgrade.

**Acceptance Criteria:**
- Each stage has an unambiguous event/condition definition.
- A user can be deterministically assigned to reached stages.
- Definitions are versioned/documented.

### ADM-051 — Funnel analytics API

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 2 — Growth | 8 pts | ADM-050 |

**User Story:** As a growth owner, I want conversion calculations so that drop-off points can be identified.

**Description:** Create backend aggregation for stage counts, conversion rates, and drop-off rates.

**Acceptance Criteria:**
- API returns counts and conversion between adjacent stages.
- Date-range and plan/source segmentation are supported where data exists.
- Users are not double-counted within a funnel cohort.

### ADM-052 — Funnel visualization

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 2 — Growth | 5 pts | ADM-051 |

**User Story:** As a growth owner, I want a funnel view so that weak conversion stages are easy to spot.

**Description:** Build interactive funnel visualization and stage detail.

**Acceptance Criteria:**
- Each stage displays users and conversion percentage.
- Drop-off is visually identifiable.
- Clicking a stage reveals relevant segmented metrics without exposing private user data.

### ADM-053 — First-value time metrics

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P2 | Release 2 — Growth | 5 pts | ADM-050 |

**User Story:** As a product owner, I want time-to-value metrics so that onboarding friction can be reduced.

**Description:** Measure signup-to-first-prompt, first-app, first-build, and first-deployment durations.

**Acceptance Criteria:**
- Median and percentile durations are calculated.
- Metrics can be compared by plan/source.
- Incomplete journeys are handled without skewing completed-duration metrics.

## EPIC 7 — AI Usage, Cost & Profitability

Track model consumption, token usage, model performance, cost per user/project/plan, and customer contribution margin.

### ADM-060 — AI request telemetry

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 8 pts | ADM-040 |

**User Story:** As an operations owner, I want every AI request measured so that usage and cost can be controlled.

**Description:** Capture provider, model, user, project, token counts, latency, status, estimated/actual cost, and timestamps.

**Acceptance Criteria:**
- Telemetry records provider and model for every supported AI request.
- Input/output tokens and total cost are captured when provider data is available.
- Failed requests are recorded with safe error categorization.
- Telemetry does not store prompt content unless explicitly allowed by policy.

### ADM-061 — AI usage dashboard

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 5 pts | ADM-060 |

**User Story:** As an administrator, I want AI usage metrics so that platform consumption is visible.

**Description:** Display total requests, successful/failed requests, tokens, cost, latency, providers, and models.

**Acceptance Criteria:**
- Dashboard supports date range and provider/model filters.
- Usage values reconcile to telemetry.
- Failed requests and latency are visible.

### ADM-062 — AI cost by user and project

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 5 pts | ADM-060, ADM-021 |

**User Story:** As an administrator, I want cost attribution so that expensive users and projects can be identified.

**Description:** Aggregate AI cost by user and project.

**Acceptance Criteria:**
- User and project detail show total AI requests, tokens, and cost.
- Admin can sort by highest cost.
- Cost is filtered by date range.

### ADM-063 — AI cost by subscription plan

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 1 — MVP | 5 pts | ADM-060, ADM-036 |

**User Story:** As a finance owner, I want cost by plan so that plan pricing can be evaluated.

**Description:** Aggregate AI usage and cost by plan.

**Acceptance Criteria:**
- Each plan shows users, revenue, AI cost, average AI cost per user, and cost/revenue ratio when revenue data exists.
- Date range filtering is supported.

### ADM-064 — AI usage limit management

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 8 pts | ADM-060, ADM-025 |

**User Story:** As a platform administrator, I want usage limits so that runaway AI costs can be controlled.

**Description:** Configure user/plan credit, request, token, daily, monthly, and rate limits.

**Acceptance Criteria:**
- Limits can be set at plan level and overridden per user where authorized.
- Usage enforcement occurs server-side.
- Approaching/exceeded limits produce clear states/events.
- Changes are audited.

### ADM-065 — AI provider/model performance comparison

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 2 — Growth | 5 pts | ADM-060 |

**User Story:** As an AI platform owner, I want provider comparisons so that routing decisions can optimize cost and quality.

**Description:** Compare request volume, success rate, latency, tokens, and cost across providers/models.

**Acceptance Criteria:**
- Provider/model metrics share common definitions.
- Unavailable cost data is shown as unknown rather than zero.
- Metrics can be filtered by time and workload category if available.

### ADM-066 — Customer contribution margin

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 2 — Growth | 8 pts | ADM-036, ADM-062 |

**User Story:** As a business owner, I want per-customer unit economics so that unprofitable usage can be identified.

**Description:** Calculate subscription revenue minus AI cost, infrastructure allocation, and payment processing cost.

**Acceptance Criteria:**
- Calculation formula and allocation rules are documented.
- Each paying user shows revenue, AI cost, infrastructure cost, payment cost, and contribution margin.
- Negative-margin customers can be filtered and ranked.
- Values are date-range aware.

### ADM-067 — Plan profitability dashboard

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 2 — Growth | 5 pts | ADM-063, ADM-066 |

**User Story:** As a business owner, I want plan-level profitability so that pricing and limits can be optimized.

**Description:** Aggregate revenue and attributable costs by subscription plan.

**Acceptance Criteria:**
- Dashboard shows revenue, AI cost, infrastructure allocation, payment fees, gross contribution, and margin percentage per plan.
- Plans can be compared across periods.

## EPIC 8 — Project Administration

Allow administrators to search, inspect, troubleshoot, suspend, archive, and manage projects created on the platform.

### ADM-070 — Project listing and search

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 5 pts | ADM-002 |

**User Story:** As a support administrator, I want to search projects so that customer build issues can be investigated.

**Description:** Create project listing with owner, type, status, framework, deployment state, usage, and last activity.

**Acceptance Criteria:**
- Search supports project ID, project name, and owner.
- Filters support status, framework/type, deployment status, date, and flagged state.
- List is paginated and sortable.

### ADM-071 — Project detail view

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 5 pts | ADM-070, ADM-060 |

**User Story:** As a support administrator, I want project detail so that I can diagnose build and deployment problems.

**Description:** Show project metadata, owner, usage, deployment history, storage/database usage, AI requests, errors, and last activity.

**Acceptance Criteria:**
- Project detail includes owner, timestamps, status, framework/type, deployment URLs/status, and usage summaries.
- Related AI cost and recent failures are visible.
- Access is restricted by admin permissions.

### ADM-072 — Project deployment history

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 1 — MVP | 5 pts | ADM-071 |

**User Story:** As a support administrator, I want deployment history so that failed releases can be diagnosed.

**Description:** Display deployments with status, environment, start/end, duration, logs/reference, and failure reason.

**Acceptance Criteria:**
- History is ordered newest first.
- Failed deployments show safe failure summaries.
- Links to logs are permission-protected.

### ADM-073 — Suspend and restore project

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 5 pts | ADM-071, ADM-005 |

**User Story:** As an administrator, I want to suspend abusive projects so that platform risk can be contained.

**Description:** Support project suspension and restoration.

**Acceptance Criteria:**
- Suspension requires reason and confirmation.
- Suspended projects cannot be executed/deployed through normal user flows.
- Restore action re-enables permitted operations.
- Actions are audited.

### ADM-074 — Archive and delete project

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 2 — Growth | 5 pts | ADM-071 |

**User Story:** As an administrator, I want lifecycle controls so that abandoned or prohibited projects can be managed.

**Description:** Support archive and controlled deletion with safeguards.

**Acceptance Criteria:**
- Archive is reversible.
- Delete requires elevated permission and confirmation.
- Deletion policy respects retention/legal constraints.
- Deletion is audited.

### ADM-075 — Flag project for review

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P2 | Release 2 — Growth | 3 pts | ADM-071 |

**User Story:** As a security administrator, I want to flag projects so that suspicious content can be reviewed.

**Description:** Add project flag with reason, severity, review status, and reviewer notes.

**Acceptance Criteria:**
- Flags can be opened, resolved, or dismissed.
- Flag history is retained.
- Flagged projects are filterable.

## EPIC 9 — System Health & Operations

Provide operational visibility into APIs, databases, queues, deployments, storage, infrastructure, and external providers.

### ADM-080 — System health aggregation API

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 8 pts | ADM-002 |

**User Story:** As an operations administrator, I want health checks in one place so that incidents can be detected quickly.

**Description:** Aggregate health for backend APIs, database, queues/jobs, storage, deployment service, authentication, AI providers, email, and payments.

**Acceptance Criteria:**
- Each component reports healthy, degraded, or unavailable.
- Health responses are safe and do not expose credentials or sensitive connection details.
- Timeouts prevent one dependency from blocking the whole health endpoint.

### ADM-081 — System health dashboard

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 5 pts | ADM-080 |

**User Story:** As an operations administrator, I want a visual health dashboard so that service degradation is obvious.

**Description:** Build component cards and incident summary.

**Acceptance Criteria:**
- Current status and last checked time are shown.
- Degraded/unavailable components are highlighted.
- Admins can view relevant recent incident/error summaries.

### ADM-082 — API performance metrics

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 1 — MVP | 5 pts | ADM-080 |

**User Story:** As an operations administrator, I want latency and error metrics so that API regressions can be detected.

**Description:** Track request volume, latency, error rate, and top failing endpoints.

**Acceptance Criteria:**
- P50/P95/P99 latency is available where telemetry supports it.
- 4xx and 5xx rates are distinguished.
- Metrics support date ranges.

### ADM-083 — Infrastructure utilization view

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 2 — Growth | 5 pts | ADM-080 |

**User Story:** As an operations administrator, I want resource usage so that capacity risks can be identified.

**Description:** Display CPU, memory, storage, database capacity, queue depth, and network metrics where available.

**Acceptance Criteria:**
- Each metric has timestamp and unit.
- Threshold states can be configured for warnings/critical levels.
- Missing telemetry is shown explicitly.

### ADM-084 — Deployment failure monitoring

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 1 — MVP | 5 pts | ADM-072, ADM-080 |

**User Story:** As an operations administrator, I want deployment failures summarized so that user-facing build issues can be investigated quickly.

**Description:** Aggregate failed deployments and common causes.

**Acceptance Criteria:**
- Failures are grouped by reason/category.
- Admins can navigate from failure summary to affected project/deployment.
- Failure counts can be filtered by date.

### ADM-085 — Critical error feed

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 1 — MVP | 5 pts | ADM-080 |

**User Story:** As an operations administrator, I want recent critical errors so that urgent incidents are visible without external log access.

**Description:** Display sanitized critical exceptions/events with correlation IDs and affected subsystem.

**Acceptance Criteria:**
- No secrets, access tokens, or sensitive payloads are displayed.
- Errors can be filtered by service, severity, and date.
- Correlation ID can be used to continue investigation in observability tooling.

## EPIC 10 — Audit, Security & Abuse Monitoring

Centralize audit events and security signals for authentication, role changes, rate limits, bans, suspicious activity, and payment-related events.

### ADM-090 — Audit log viewer

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 5 pts | ADM-005 |

**User Story:** As a security administrator, I want searchable audit logs so that privileged changes can be investigated.

**Description:** Create audit log listing and detail view.

**Acceptance Criteria:**
- Logs can be filtered by admin, action, target, result, and date.
- Before/after values are shown when available.
- Audit data is read-only from the admin UI.

### ADM-091 — Security event model

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P0 | Release 1 — MVP | 5 pts | ADM-040 |

**User Story:** As a security owner, I want a common security event model so that suspicious activity can be analyzed consistently.

**Description:** Define event types for login failures, brute force, unusual access, rate-limit violations, bans, payment anomalies, and abuse signals.

**Acceptance Criteria:**
- Event includes type, severity, subject, timestamp, source, and safe metadata.
- Severity uses INFO, WARNING, HIGH, CRITICAL.
- Events can be correlated to user/project/admin IDs where appropriate.

### ADM-092 — Security events dashboard

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 1 — MVP | 5 pts | ADM-091 |

**User Story:** As a security administrator, I want security events summarized so that risky activity can be prioritized.

**Description:** Display open/recent security events by severity and type.

**Acceptance Criteria:**
- Events can be filtered by severity, type, user, project, and date.
- Critical and high events are clearly prioritized.
- Event detail links to related user/project when permitted.

### ADM-093 — Suspicious login detection

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 2 — Growth | 8 pts | ADM-026, ADM-091 |

**User Story:** As a security owner, I want suspicious login rules so that likely account compromise can be flagged.

**Description:** Detect configured suspicious patterns such as repeated failures, impossible travel where reliable, unusual device, or sudden IP changes.

**Acceptance Criteria:**
- Rules are configurable and documented.
- Detection creates security events rather than automatically banning by default.
- False-positive-prone signals can be disabled.

### ADM-094 — Rate-limit and API abuse monitoring

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 2 — Growth | 5 pts | ADM-091, ADM-064 |

**User Story:** As a security administrator, I want abuse metrics so that automated misuse can be identified.

**Description:** Aggregate rate-limit breaches, excessive requests, and blocked abuse patterns.

**Acceptance Criteria:**
- Violations can be grouped by user, IP where lawful, endpoint, and project.
- Repeated violations create or raise security events.
- No automated permanent ban occurs without configured policy.

### ADM-095 — Account ban workflow

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 1 — MVP | 5 pts | ADM-023, ADM-091 |

**User Story:** As a security administrator, I want a formal ban workflow so that severe abuse actions are consistent and auditable.

**Description:** Add ban confirmation, reason, evidence/reference, and optional expiry.

**Acceptance Criteria:**
- Only authorized roles can ban.
- Permanent vs temporary ban is explicit.
- User sessions/tokens are invalidated according to policy.
- Ban/reversal is audited.

## EPIC 11 — Alerts & Notifications

Proactively notify administrators when business, cost, security, or platform thresholds are exceeded.

### ADM-100 — Alert rule engine

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 2 — Growth | 8 pts | ADM-080, ADM-091 |

**User Story:** As an operations owner, I want configurable alert rules so that important conditions are detected automatically.

**Description:** Create rule framework for thresholds, severity, cooldown, and recipient groups.

**Acceptance Criteria:**
- Rules support metric, operator, threshold, window, severity, and enabled state.
- Repeated alerts respect cooldown/deduplication.
- Rule changes are audited.

### ADM-101 — Default platform alert rules

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 2 — Growth | 5 pts | ADM-100 |

**User Story:** As a platform owner, I want useful default alerts so that critical conditions are covered immediately.

**Description:** Seed alerts for AI spend, payment failure rate, API errors, provider outages, database/deployment failures, suspicious activity, cancellations, and infrastructure spikes.

**Acceptance Criteria:**
- Default rules can be enabled/disabled by authorized admins.
- Thresholds are configurable.
- Each rule maps to an owning admin role/group.

### ADM-102 — Admin alert center

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 2 — Growth | 5 pts | ADM-100 |

**User Story:** As an administrator, I want an alert inbox so that active issues can be acknowledged and resolved.

**Description:** Build alert listing/detail with state and ownership.

**Acceptance Criteria:**
- Alerts support open, acknowledged, resolved, and dismissed states.
- Alert detail shows triggering metric/event and related resource.
- State changes are audited.

### ADM-103 — External notification delivery

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P2 | Release 2 — Growth | 8 pts | ADM-100, ADM-102 |

**User Story:** As an operations owner, I want important alerts delivered externally so that critical issues are not missed.

**Description:** Deliver configured alerts through supported channels such as email or team messaging integration.

**Acceptance Criteria:**
- Critical notifications include severity, summary, timestamp, and link to admin detail.
- Delivery failures are retried safely and logged.
- Recipients are configurable by role/group.

## EPIC 12 — Admin Settings, Exports & Governance

Provide controlled settings, configuration visibility, data exports, and operational governance capabilities.

### ADM-110 — Admin settings framework

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 1 — MVP | 5 pts | ADM-002, ADM-005 |

**User Story:** As a super administrator, I want centralized settings so that operational configuration can be managed safely.

**Description:** Create typed admin settings with permissions, validation, and audit history.

**Acceptance Criteria:**
- Only authorized roles can modify settings.
- Settings are validated server-side.
- Sensitive secrets are never returned in plain text.
- Changes are audited.

### ADM-111 — Configure usage and cost thresholds

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 2 — Growth | 5 pts | ADM-064, ADM-110 |

**User Story:** As a super administrator, I want configurable thresholds so that cost and capacity controls can evolve without deployments.

**Description:** Manage AI budget thresholds, warning levels, account limits, and health thresholds.

**Acceptance Criteria:**
- Thresholds validate units and ranges.
- Changes take effect predictably and are auditable.
- Existing user overrides remain visible.

### ADM-112 — CSV export for admin tables

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P2 | Release 2 — Growth | 5 pts | ADM-020, ADM-030, ADM-032, ADM-070 |

**User Story:** As an administrator, I want exports so that approved data can be analyzed externally.

**Description:** Add permission-controlled CSV export for users, payments, subscriptions, projects, and analytics summaries.

**Acceptance Criteria:**
- Export respects current filters and permissions.
- Sensitive fields are excluded or masked by default.
- Large exports use a safe scalable mechanism.
- Export actions are audited.

### ADM-113 — Scheduled business reports

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P2 | Release 3 — Optimization | 8 pts | ADM-036, ADM-041, ADM-061, ADM-051 |

**User Story:** As a business owner, I want scheduled reports so that key metrics arrive automatically.

**Description:** Generate periodic summaries for users, revenue, AI cost, conversion, churn, and incidents.

**Acceptance Criteria:**
- Report cadence and recipients are configurable.
- Reports include the selected reporting period and metric definitions.
- Failures are logged and surfaced.

### ADM-114 — Data retention and privacy controls

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P1 | Release 2 — Growth | 8 pts | ADM-090, ADM-091, ADM-060 |

**User Story:** As a compliance owner, I want retention policies so that operational data is managed responsibly.

**Description:** Define retention for audit logs, security events, telemetry, exports, and other admin data.

**Acceptance Criteria:**
- Retention policies are documented and configurable where appropriate.
- Deletion/anonymization jobs respect legal holds and required records.
- Admin access to sensitive retained data is role-controlled.

### ADM-115 — Admin analytics glossary

| Priority | Release | Estimate | Dependencies |
|---|---|---|---|
| P2 | Release 2 — Growth | 3 pts | ADM-036, ADM-041, ADM-066 |

**User Story:** As an administrator, I want metric definitions so that teams interpret dashboards consistently.

**Description:** Add an accessible glossary for MRR, ARR, DAU/WAU/MAU, churn, conversion, retention, AI cost, and margin.

**Acceptance Criteria:**
- Every major dashboard metric has a written definition.
- Definitions identify time window and inclusion/exclusion rules.
- Glossary is linked from relevant analytics pages.

## Cross-Cutting Definition of Done

- Backend authorization is enforced for every privileged endpoint; frontend hiding is not treated as security.
- All privileged state-changing actions produce immutable audit events.
- APIs include validation, predictable error responses, and correlation IDs where applicable.
- UI includes loading, empty, success, error, and permission-denied states.
- Automated tests cover core business rules, permission boundaries, and high-risk actions.
- Sensitive information such as secrets, tokens, full payment instrument data, and raw provider credentials is never displayed in admin.
- Production telemetry is emitted for performance, errors, and relevant business events.
- Database queries used by dashboard/analytics endpoints are indexed or otherwise optimized for expected scale.
- Changes are documented sufficiently for operations/support teams and include rollback considerations where appropriate.

## Suggested MVP Sprint Order

| Sprint | Tickets | Focus |
|---|---|---|
| Sprint 1 | ADM-001–005 | Admin shell, RBAC, authentication, audit foundation |
| Sprint 2 | ADM-010–014, ADM-080–081 | Dashboard and health foundations |
| Sprint 3 | ADM-020–025 | User administration |
| Sprint 4 | ADM-030–036 | Payments, subscriptions, revenue |
| Sprint 5 | ADM-060–064 | AI telemetry, cost, limits |
| Sprint 6 | ADM-070–073, ADM-084–085 | Project operations and failures |
| Sprint 7 | ADM-040–042, ADM-090–092, ADM-095 | Core analytics and security |
| Sprint 8 | ADM-110 and stabilization | Settings, end-to-end hardening, performance, UAT |

**Total backlog tickets: 74** | Suggested estimation scale: Fibonacci story points (2, 3, 5, 8).
