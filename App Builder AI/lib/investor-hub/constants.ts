export const PIPELINE_STAGES = [
  'DISCOVERED',
  'RESEARCHED',
  'QUALIFIED',
  'OUTREACH_DRAFTED',
  'CONTACTED',
  'REPLIED',
  'MEETING_SCHEDULED',
  'PITCH_DELIVERED',
  'DUE_DILIGENCE',
  'NEGOTIATION',
  'FUNDING_SECURED',
  'DECLINED',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  DISCOVERED: 'Discovered',
  RESEARCHED: 'Researched',
  QUALIFIED: 'Qualified',
  OUTREACH_DRAFTED: 'Outreach drafted',
  CONTACTED: 'Contacted',
  REPLIED: 'Replied',
  MEETING_SCHEDULED: 'Meeting scheduled',
  PITCH_DELIVERED: 'Pitch delivered',
  DUE_DILIGENCE: 'Due diligence',
  NEGOTIATION: 'Negotiation',
  FUNDING_SECURED: 'Funding secured',
  DECLINED: 'Declined',
};

export const INVESTOR_TYPES = [
  'VC',
  'ANGEL',
  'FAMILY_OFFICE',
  'GRANT',
  'ACCELERATOR',
  'LENDER',
  'OTHER',
] as const;
export type InvestorType = (typeof INVESTOR_TYPES)[number];

export const INSTRUMENTS = ['equity', 'debt', 'grant'] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

export const COMPANY_STAGES = ['idea', 'pre-seed', 'seed', 'series a', 'series b', 'growth'] as const;

export const OUTREACH_KINDS = ['EMAIL', 'FOLLOW_UP', 'LINKEDIN', 'CALL_SCRIPT', 'MEETING_REQUEST'] as const;
export type OutreachKind = (typeof OUTREACH_KINDS)[number];

export const REPLY_CLASSES = [
  'interested',
  'more_info',
  'deck_requested',
  'meeting_requested',
  'follow_up',
  'not_interested',
  'wrong_contact',
  'unsubscribe',
] as const;
export type ReplyClass = (typeof REPLY_CLASSES)[number];

/** Emails marked as sent per project per day (manual sends are logged, not delivered by us). */
export const DAILY_SEND_LIMIT = Number(process.env.INVESTOR_HUB_DAILY_SEND_LIMIT ?? 20);
/** Maximum automatic follow-ups after the first email before the sequence stops. */
export const MAX_FOLLOW_UPS = 2;
