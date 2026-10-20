# Personal data map (GDPR / POPIA)

Inventory of every Prisma model that holds personal data. Keep this file in step with `prisma/schema.prisma`: a new model with personal data needs a row here, an entry in `lib/privacy/user-data.ts` (export) and a deletion rule in `lib/privacy/user-erasure.ts` / `lib/privacy/subject.ts`.

**Roles.** AppWeaver AI is the *controller* for account, billing, security and platform-outreach data. For data its customers collect through their own sites and campaigns (leads, form submissions, messaging contacts, project reviews, investor CRM, meeting participants) the customer is the controller and AppWeaver AI is the *processor*; data-subject requests for those records are still handled by the admin queue (`/admin/privacy`) on the customer's behalf.

**Retention column.** "Policy" = configurable under `/admin/privacy` (`lib/privacy/retention.ts`, off and dry-run until enabled). "Account" = deleted with the account after the 14-day grace period (`PRIVACY_DELETION_GRACE_DAYS`). "Kept" = retained after account deletion in anonymised form for the stated legal reason.

**Erasure columns.** *Account erasure* = user deletes their account. *Subject erasure* = admin DSAR erase (`eraseSubject`). Opt-out records are never dropped: they are rewritten as HMAC-SHA256 hashes (`h1:` prefix, `PRIVACY_HASH_SECRET`) so a suppression survives erasure without keeping the address.

## Processors and sub-processors

| Processor | Data sent | Purpose |
| --- | --- | --- |
| Vercel / hosting, PostgreSQL provider | all data (storage) | Hosting |
| AWS S3 (and Bedrock) | media, video, export files, prompts | Object storage, AI generation |
| Stripe | email, name, billing details, payment metadata | Payments, subscriptions, tax records |
| SMTP provider | recipient email, message content | Transactional and outreach email |
| Twilio / voice and SMS provider | phone numbers, SMS text, call audio/transcripts | SMS, WhatsApp, AI voice calls |
| Meta (Facebook, Instagram, WhatsApp, Ads) | messages, contact identifiers, ad audiences | Messaging channels, customer ads |
| X, LinkedIn | posts, profile identifiers, OAuth tokens | Scheduled social posts |
| Google (Calendar / Meet, OAuth login) | calendar events, attendee emails, OAuth tokens | Meetings, sign-in |
| GitHub | repository sync, OAuth token | Code sync |
| AI model providers | prompts and generated content | Product features |
| Sentry (when enabled) | error context, user id | Monitoring |

## Account and identity

| Models | Personal data | Purpose | Lawful basis | Retention | Erasure |
| --- | --- | --- | --- | --- | --- |
| `User`, `UserSettings`, `UserFlag` | name, email, image, locale, admin notes/flags | Account, support, abuse prevention | Contract; legitimate interest (UserFlag) | Account; `User` row kept anonymised (`erased-<id>@erased.invalid`, DISABLED) because projects and billing reference it | Row anonymised; settings deleted; UserFlag kept (fraud/abuse) |
| `Account`, `Session`, `Verification`, `CliToken`, `CliDeviceAuthorization`, `PendingAuthReminder` | OAuth tokens, password hash, IP, user agent, email | Authentication | Contract; security | Account | Deleted (tokens never exported) |
| `UserGithubConnection`, `SocialConnection`, `MetaAdConnection`, `CalendarConnection`, `ChannelConnection`, `ProjectGithubLink` | provider ids, encrypted tokens | Integrations | Contract | Account | Tokens revoked at the provider where supported (Google), then deleted |
| `SsoProvider` | IdP metadata (no end-user data) | Enterprise SSO | Contract | Workspace | Deleted with workspace |
| `Workspace`, `WorkspaceMember`, `WorkspaceInvitation`, `ProjectMember`, `ProjectInvitation`, `UserProjectPreference` | member emails, roles | Collaboration | Contract | Account | Sole-owner workspaces deleted; shared workspaces transferred; memberships and invitations deleted |
| `UserBrandKit`, `UserSavedSection`, `UserSavedPage`, `UserTemplateFavorite`, `ProjectBrandKit` | brand assets, saved content | Product features | Contract | Account | Deleted |
| `FeedbackMessage`, `ProductReview` | name, email, free text | Support, product reviews | Consent / legitimate interest | Account | Deleted (subject erase: deleted or author anonymised) |

## Projects and generated content

| Models | Personal data | Purpose | Lawful basis | Retention | Erasure |
| --- | --- | --- | --- | --- | --- |
| `Project`, `ProjectFile`, `ProjectCheckpoint(File)`, `Artifact`, `Deployment`, `ProjectDatabase`, `ProjectStorage`, `ProjectCustomDomain`, `ProjectSubdomain`, `ProjectSecret`, `ProjectHealthCheck`, `ProjectIssue`, `ProjectKnowledge`, `LaunchKit`, `LaunchReport`, `GrowthExperiment` | user content, domains, secrets | Service delivery | Contract | Account | Sole-owner projects deleted with their children |
| `AgentConversation`, `AgentMessage`, `AgentToolCall`, `AgentActivity`, `AgentSetting` | prompts and AI replies (may contain personal data) | AI assistance | Contract | Account | Deleted |
| `ProjectPageView` | hashed visitor id, path, referrer, country | Site analytics | Legitimate interest | Aggregate only | Deleted with project; exported as a count |
| `AiUsageEvent`, `AdAttribution` | user id, token counts, cost | Metering, billing disputes | Contract; legal obligation | Kept | Retained (no direct identifiers beyond the anonymised user id) |
| `GrowthVisit`, `GrowthAttribution`, `GrowthFeatureEvent` | random first-party visitor id (no IP, no user agent), UTM/referrer host/landing path, feature event names; signed cookie `aw_gv` set only with analytics consent and no DNT/GPC | Acquisition attribution and product analytics | Consent (acquisition); legitimate interest (signed-in feature telemetry) | Deleted on account erasure (GrowthAttribution, GrowthFeatureEvent); GrowthVisit holds only an unlinked random id | Anonymous visits are not linkable to a person |

## Leads, forms and reviews (customer-controlled)

| Models | Personal data | Purpose | Lawful basis | Retention | Erasure |
| --- | --- | --- | --- | --- | --- |
| `Lead`, `LeadActivity`, `LeadFollowUp`, `LeadEmailDraft`, `LeadBooking`, `LeadAvailabilitySlot` | name, email, phone, company, notes, consent text/time | Lead capture and follow-up | Consent / legitimate interest (customer) | Policy `lost_leads` (status LOST); otherwise account | Deleted; opt-outs hashed first |
| `ProjectFormSubmission`, `ProjectSupportTicket` | name, email, message | Contact forms, support | Legitimate interest | Account | Deleted |
| `ProjectReview`, `ProjectReviewSettings` | reviewer name, email, text | Public reviews | Consent | Account | Subject erase anonymises author fields; text kept only if no PII remains |
| `ConsentProof` | contact, IP, user agent, wording shown | Evidence of consent | Legal obligation (proof of consent) | Kept while the consent relied on exists | Contact hashed/anonymised on erase |

## Investor hub and outreach

| Models | Personal data | Purpose | Lawful basis | Retention | Erasure |
| --- | --- | --- | --- | --- | --- |
| `HubInvestor`, `HubInvestorActivity`, `HubInvestorOutreach`, `HubInvestorReply`, `HubInvestorContact` | name, firm, work email, phone, LinkedIn, notes, SMS consent | Fundraising CRM | Legitimate interest (B2B); consent for SMS | Policy `investor_contacts` (untouched DISCOVERED/RESEARCHED/DECLINED) | Deleted; opt-outs hashed |
| `HubInvestorCall`, `HubInvestorSms`, `InvestorVoiceCall`, `InvestorMeetingRequest` | call notes, SMS text, transcripts, phone | Outreach history | Legitimate interest / consent | Policy `call_logs`; transcripts via `transcripts` | Deleted |
| `InvestorConsent` | investor id, consent type, source, IP | Consent evidence for SMS/voice | Legal obligation | Kept while relied on | Revoked on withdrawal; anonymised on erase |
| `InvestorCampaign`, `InvestorCampaignTarget`, `InvestorCampaignSend`, `InvestorHubProfile` | target name, email, send log | Campaigns | Legitimate interest | Account | Deleted |
| `InvestorLead` | platform-level investor prospects: name, email | Platform fundraising outreach | Legitimate interest | Until DO_NOT_CONTACT or erased | Deleted; DO_NOT_CONTACT hashed |
| `OutreachSuppression` | email (hashed after erasure) | Do-not-contact list | Legal obligation / legitimate interest | Kept indefinitely as hash | Plain emails rewritten to `h1:` hashes |

## Messaging, meetings and consents

| Models | Personal data | Purpose | Lawful basis | Retention | Erasure |
| --- | --- | --- | --- | --- | --- |
| `Conversation`, `InboxMessage`, `MediaAsset`, `MessageStatusEvent` | contact handle, name, message bodies, attachments | Unified inbox | Contract / legitimate interest (customer) | Policy `messages` (inactive conversations) | Conversation, messages and S3 media deleted |
| `ContactConsent` | contact, opt-in/out, source | Messaging consent state | Consent | While relationship exists | Anonymised/hashed on erase; withdrawable under `/admin/privacy` |
| `MessagingSuppression` | contact (hashed after erasure), reason | STOP / opt-out list | Legal obligation | Kept as hash | Rewritten as `h1:` hash; lifted only by a new opt-in |
| `ChannelVerification` | verification codes, contact | Channel ownership proof | Contract | Short-lived | Deleted with account |
| `Meeting`, `MeetingSlotProposal`, `MeetingSlotLock`, `MeetingReminder`, `MeetingNotification`, `MeetingAudit`, `MeetingType`, `MeetingAvailabilityRule`, `MeetingSettings`, `CalendarBookingSync`, `CalendarOAuthState` | participants (name, email, phone), notes, transcript, calendar ids | Scheduling | Contract / consent | Policy `meeting_notes`, `transcripts`; settings `retentionDays` | Scheduled meetings cancelled; participants anonymised; notes cleared |
| `PlatformKnowledge` | no personal data expected | Support knowledge | — | — | — |

## Social and marketing

| Models | Personal data | Purpose | Lawful basis | Retention | Erasure |
| --- | --- | --- | --- | --- | --- |
| `SocialPost`, `SocialInteraction`, `ProjectCampaign`, `ProjectPost`, `ContentPipeline`, `ContentRun`, `CustomerAd`, `AdCreative`, `AdState` | commenter handles/names, replies, post content | Social publishing and reply handling | Contract; legitimate interest | Account | Scheduled posts cancelled; rows deleted |
| `VideoJob`, `VideoProject`, `VideoScene`, `VideoRelease`, `VideoProviderConfig` | scripts, voice/likeness inputs, media | Video generation | Contract | Account | Deleted; S3 objects removed |

## Billing and compliance records (retained)

| Models | Personal data | Purpose | Lawful basis | Retention | Erasure |
| --- | --- | --- | --- | --- | --- |
| `CreditLedger`, `CreditAdjustment` | user id, amounts, reasons | Credit accounting | Legal obligation (tax/accounting), contract | Kept (7 years suggested) | Retained; user row anonymised |
| `MarketingWallet`, `MarketingLedger`, `MarketingCreditLot`, `MarketingPurchase`, `MarketingReservation`, `MarketingProjectBudget`, `MarketingOrgControl`, `InternalMarketingCost` | purchase records, Stripe ids | Prepaid marketing credits | Legal obligation | Kept | Retained; subscriptions cancelled; Stripe customer scrubbed of name/email |
| `StripeEvent` | Stripe payload (customer ids) | Webhook idempotency, audit | Legal obligation | Kept | Retained |
| `MarketingPriceItem`, `MarketingPackage`, `AppFeature`, `AdminSetting` | none | Configuration | — | — | — |

## Security, audit and operations

| Models | Personal data | Purpose | Lawful basis | Retention | Erasure |
| --- | --- | --- | --- | --- | --- |
| `AdminAuditLog` | admin id/email, target ids, before/after snapshots | Accountability of privileged actions | Legitimate interest; legal obligation | Kept | Subject identifiers inside snapshots scrubbed; row kept |
| `AdminAccessLog`, `SecurityEvent` | IP, user agent, user id | Security monitoring | Legitimate interest | Kept (short) | Subject identifiers scrubbed |
| `PrivacyRequest`, `PrivacyRequestEvent` | requester name, email, phone, details; hashes | DSAR handling | Legal obligation | Kept as hashes after closure; contact fields scrubbed on erasure requests | Contact fields nulled when an ERASURE request completes |
| `PrivacyExportJob` | export zip (all of one user's data) | Self-service export | Legal obligation | 7 days, then file and bytes deleted | Deleted on account erasure |
| `PrivacyDeletionRequest` | user id, schedule | Grace period tracking | Legal obligation | Kept | Retained (no PII) |
| `PrivacyRetentionPolicy` | none | Retention configuration | — | — | — |
| `BackupRun`, `ScanRun`, `ScanFinding`, `SmokeCheck` | none (operational) | Operations | — | — | — |

## Known limits

- Backups are immutable snapshots; erased data ages out when the backup expires and is not restored without re-applying the erasure log.
- Provider-side deletion (Meta, X, LinkedIn, GitHub) is not automated: tokens are deleted locally, only Google tokens are revoked at the provider.
- Phone matching for third-party requests is digit-based; national-format numbers without a country code may not match E.164 records.
- `PRIVACY_HASH_SECRET` (fallback `BETTER_AUTH_SECRET`, then a dev-only constant that throws in production) keys the hashed opt-outs. **Set it explicitly and never change it**: rotating `BETTER_AUTH_SECRET` while relying on the fallback silently breaks every hashed suppression. See `.env.example`.
- Provisioned external databases/buckets (Neon, R2) referenced by `ProjectDatabase`/`ProjectStorage` are only metadata rows here; they are deleted locally but the external resources are not dropped.
- Project workspace files on disk (`public/project-workspace/<projectId>`) are removed on account deletion. On serverless hosts with ephemeral disks this is a no-op.
