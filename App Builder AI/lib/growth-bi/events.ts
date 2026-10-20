/** Closed registry of product-feature events. Add a name here before calling trackFeature with it. */
export const FEATURE_EVENTS = [
  'project.created',
  'project.prompt_sent',
  'preview.opened',
  'project.published',
  'domain.connected',
  'design.imported',
  'github.connected',
  'marketing.campaign_created',
  'video.generated',
  'ads.created',
  'team.invited',
  'checkpoint.restored',
  'staging.created',
] as const;

export type FeatureEventName = (typeof FEATURE_EVENTS)[number];

export const isFeatureEvent = (value: unknown): value is FeatureEventName =>
  typeof value === 'string' && (FEATURE_EVENTS as readonly string[]).includes(value);
