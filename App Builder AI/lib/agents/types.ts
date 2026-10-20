/** Client-safe constants for the agent orchestration core (no server imports). */

export const AGENT_ROLES = [
  'MARKETING_DIRECTOR',
  'CONTENT',
  'SOCIAL_MANAGER',
  'CUSTOMER_ENGAGEMENT',
  'INVESTOR',
  'VOICE_MESSAGING',
  'GROWTH_ANALYST',
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_MODES = ['ASSIST', 'APPROVAL', 'AUTONOMOUS'] as const;
export type AgentModeName = (typeof AGENT_MODES)[number];

export const ACTIVITY_STATUSES = [
  'PLANNED',
  'AWAITING_APPROVAL',
  'RUNNING',
  'DONE',
  'FAILED',
  'BLOCKED',
] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export type AgentRisk = 'LOW' | 'MEDIUM' | 'HIGH';

/** Scope of an agent: the platform itself, or one project. */
export type AgentScope =
  | { type: 'PLATFORM' }
  | { type: 'PROJECT'; projectId: string };

export const PLATFORM_SCOPE_ID = 'PLATFORM';

export const AGENT_LABELS: Record<AgentRole, { label: string; description: string }> = {
  MARKETING_DIRECTOR: { label: 'Marketing Director', description: 'Plans campaigns and weekly priorities.' },
  CONTENT: { label: 'Content', description: 'Drafts posts, videos and captions.' },
  SOCIAL_MANAGER: { label: 'Social Manager', description: 'Schedules and publishes social content.' },
  CUSTOMER_ENGAGEMENT: { label: 'Customer Engagement', description: 'Answers customer messages and reviews.' },
  INVESTOR: { label: 'Investor', description: 'Finds investors and drafts outreach.' },
  VOICE_MESSAGING: { label: 'Voice & Messaging', description: 'SMS, WhatsApp and call follow-ups.' },
  GROWTH_ANALYST: { label: 'Growth Analyst', description: 'Reports on leads, spend and results.' },
};

export const MODE_EXPLANATIONS: Record<AgentModeName, string> = {
  ASSIST: 'The agent only drafts and suggests. Nothing is sent, posted or spent.',
  APPROVAL: 'The agent prepares actions and waits for you to approve each one before it runs.',
  AUTONOMOUS:
    'The agent runs actions in the categories you allow by itself, within your daily limits. High-risk actions (refunds, commitments, paid spend, first outbound campaign, permission or sensitive data changes) still need your approval every time.',
};

/** Suggested categories an owner can allow to run autonomously. */
export const AGENT_CATEGORIES = [
  'content_draft',
  'social_post',
  'customer_reply',
  'review_reply',
  'investor_outreach',
  'message_followup',
  'report',
] as const;
export type AgentCategory = (typeof AGENT_CATEGORIES)[number];

/** Action kinds that are high-risk in every mode and always need per-action approval. */
export const HIGH_RISK_KINDS = [
  'refund',
  'binding_commitment',
  'permission_change',
  'paid_spend',
  'first_outbound_campaign',
  'sensitive_data_change',
] as const;
export type HighRiskKind = (typeof HIGH_RISK_KINDS)[number];

export function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === 'string' && (AGENT_ROLES as readonly string[]).includes(value);
}

export function isAgentMode(value: unknown): value is AgentModeName {
  return typeof value === 'string' && (AGENT_MODES as readonly string[]).includes(value);
}

export function scopeId(scope: AgentScope): string {
  return scope.type === 'PLATFORM' ? PLATFORM_SCOPE_ID : scope.projectId;
}
