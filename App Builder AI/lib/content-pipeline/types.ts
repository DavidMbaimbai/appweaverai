/** Client-safe constants for the daily content pipeline (no server imports). */

export const PIPELINE_STEPS = ['strategy', 'generate', 'image', 'video', 'validate', 'schedule', 'report'] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];

export const STEP_LABELS: Record<PipelineStep, string> = {
  strategy: 'Load strategy',
  generate: 'Write posts',
  image: 'Create image',
  video: 'Create video',
  validate: 'Validate',
  schedule: 'Schedule',
  report: 'Publish results',
};

export type StepStatus = 'PENDING' | 'DONE' | 'FAILED' | 'WAITING' | 'SKIPPED' | 'AWAITING_APPROVAL' | 'BLOCKED';

export type StepState = {
  status: StepStatus;
  at?: string;
  detail?: string;
  activityId?: string;
  data?: Record<string, unknown>;
};

export type StepMap = Partial<Record<PipelineStep, StepState>>;

export const CONTENT_TYPES = ['post', 'image', 'video'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** Platforms the house pipeline posts to (existing SocialPost publisher). */
export const PLATFORM_SCOPE_PLATFORMS = ['X', 'LINKEDIN', 'FACEBOOK'] as const;
export const CUSTOMER_SCOPE_PLATFORMS = ['X', 'LINKEDIN', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK'] as const;
/** Platforms the video release system can publish to. */
export const VIDEO_PLATFORMS = ['YOUTUBE', 'FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'X', 'TIKTOK'] as const;

export const SUPPORTED_LANGUAGES: Record<string, string> = {
  en: 'English',
  nl: 'Dutch',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
};

export const PIPELINE_CATEGORIES = ['social_post', 'content_draft'] as const;

export const MAX_POSTS_PER_DAY = 5;
export const VIDEO_SECONDS = 6;
export const RUN_LOCK_MS = 10 * 60_000;

export type PipelineConfig = {
  enabled: boolean;
  timeOfDay: string;
  timeZone: string;
  postsPerDay: number;
  platforms: string[];
  languages: string[];
  contentTypes: string[];
  preferredPostTimes: string[];
  autoPublishCategories: string[];
  objective: string;
  maxDailyCredits: number;
};

export const DEFAULT_CONFIG: PipelineConfig = {
  enabled: false,
  timeOfDay: '09:00',
  timeZone: 'UTC',
  postsPerDay: 1,
  platforms: ['X', 'LINKEDIN'],
  languages: ['en'],
  contentTypes: ['post'],
  preferredPostTimes: ['10:00'],
  autoPublishCategories: [],
  objective: '',
  maxDailyCredits: 0,
};
