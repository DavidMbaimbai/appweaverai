export type VideoMode = 'TEXT' | 'IMAGE' | 'VIDEO';
export type VideoAspect = '16:9' | '9:16' | '1:1';

export type VideoCapabilities = {
  textToVideo: boolean;
  imageToVideo: boolean;
  videoToVideo: boolean;
  /** Longest clip a single job may request. */
  maxSeconds: number;
  /** Shortest clip; requested seconds must be minSeconds + n * secondsStep. */
  minSeconds: number;
  secondsStep: number;
  /** Longest clip when a reference image is used (defaults to maxSeconds). */
  imageToVideoMaxSeconds?: number;
  aspectRatios: VideoAspect[];
  /** Relative output quality, 1 (basic) to 10 (best). Used by auto-selection. */
  qualityScore: number;
};

export type VideoRequest = {
  mode: VideoMode;
  prompt: string;
  seconds: number;
  aspect: VideoAspect;
  /** Required for IMAGE mode. */
  inputImage?: { format: 'png' | 'jpeg'; bytes: Buffer };
  /** Stable per job so a retried submit never creates a second paid generation. */
  idempotencyKey: string;
  model?: string;
};

export type VideoPollStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export type VideoPollResult = {
  status: VideoPollStatus;
  /** 0-100 when the provider reports it; otherwise omitted. */
  progress?: number;
  /** Provider-side location of the finished video (an object key). */
  outputRef?: string;
  error?: string;
};

/** Thrown for failures worth retrying (throttling, timeouts, 5xx). */
export class TransientVideoError extends Error {
  readonly transient = true;
}

/** Thrown for failures that retrying cannot fix (bad config, rejected input). */
export class VideoConfigError extends Error {
  readonly transient = false;
}

export interface VideoProvider {
  id: string;
  label: string;
  /** Default model id; admins may list others in VideoProviderConfig.models. */
  defaultModel: string;
  capabilities: VideoCapabilities;
  /** Whether credentials/storage are configured. Never fakes availability. */
  isConfigured(): { ok: true } | { ok: false; reason: string };
  estimateCostCents(request: Pick<VideoRequest, 'mode' | 'seconds' | 'model'>): number;
  /** Validates provider-specific limits (prompt length, seconds, aspect). */
  validate(request: VideoRequest): string | null;
  submit(request: VideoRequest): Promise<{ externalId: string }>;
  poll(externalId: string): Promise<VideoPollResult>;
  /** Providers without a cancel API omit this; the job is simply no longer tracked. */
  cancel?(externalId: string): Promise<void>;
  /** Confirms the finished video exists and returns where it lives. */
  fetchResult(
    externalId: string,
    outputRef?: string,
  ): Promise<{ outputKey: string; contentType: string }>;
}
