export type ReleaseStatusName =
  | 'DRAFT'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'MANUAL'
  | 'CANCELLED'
  | 'PAUSED';

export type ReleaseView = {
  id: string;
  platform: string;
  language: string;
  title: string;
  caption: string;
  hashtags: string[];
  status: ReleaseStatusName;
  scheduledAt: string;
  timeZone: string;
  jobId: string;
  season: number | null;
  episode: number | null;
  seriesKey: string | null;
  error: string | null;
  note: string | null;
  postUrl: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  views: number | null;
};

export type CapabilityView = {
  platform: string;
  label: string;
  /** What this deployment supports at all. */
  deploymentMode: 'automatic' | 'manual';
  /** What will actually happen for this owner right now. */
  effective: 'automatic' | 'manual';
  connected: boolean;
  expired: boolean;
  accountName: string | null;
  note: string;
  privateOnly: boolean;
  limits: string;
  connectHref: string | null;
  connectHint: string;
};

export type VideoOption = { jobId: string; label: string; seconds: number; aspect: string };

export type ProjectOption = { id: string; title: string; kind: 'STANDALONE' | 'SERIES'; episodes: number };

export type SchedulerData = {
  nowIso: string;
  releases: ReleaseView[];
  capabilities: CapabilityView[];
  videos: VideoOption[];
  projects: ProjectOption[];
  pendingCount: number;
  pendingLimit: number;
  connectFlag: string | null;
};

export const STATUS_STYLES: Record<ReleaseStatusName, string> = {
  DRAFT: 'bg-app-surface-hover text-app-text-muted',
  SCHEDULED: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  APPROVED: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  PUBLISHING: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  PUBLISHED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  FAILED: 'bg-red-500/15 text-red-700 dark:text-red-300',
  MANUAL: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  CANCELLED: 'bg-app-surface-hover text-app-text-muted line-through',
  PAUSED: 'bg-app-surface-hover text-app-text-secondary',
};

/** "Scheduled" means waiting for the owner's approval; only "Approved" releases publish. */
export const STATUS_LABELS: Record<ReleaseStatusName, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Awaiting approval',
  APPROVED: 'Approved',
  PUBLISHING: 'Publishing',
  PUBLISHED: 'Published',
  FAILED: 'Failed',
  MANUAL: 'Manual post needed',
  CANCELLED: 'Cancelled',
  PAUSED: 'Paused',
};

export const inputClass =
  'rounded-lg border border-app-border-subtle bg-app-surface px-3 py-2 text-sm text-app-text';
export const ghostButton =
  'rounded-lg border border-app-border-subtle px-3 py-1.5 text-sm text-app-text disabled:opacity-50';
export const primaryButton =
  'rounded-lg bg-appweaver-orange px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50';

export function dayKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function timeOf(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

export function dateTimeLabel(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}
