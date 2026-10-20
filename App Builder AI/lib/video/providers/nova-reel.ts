import {
  BedrockRuntimeClient,
  GetAsyncInvokeCommand,
  StartAsyncInvokeCommand,
} from '@aws-sdk/client-bedrock-runtime';

import { getVideoStorageConfig, headVideoObject } from '@/lib/video/storage';

import {
  TransientVideoError,
  VideoConfigError,
  type VideoPollResult,
  type VideoProvider,
  type VideoRequest,
} from './types';

export const NOVA_REEL_ID = 'nova-reel';
export const NOVA_REEL_MODEL = 'amazon.nova-reel-v1:1';
/** List price is roughly 0.08 USD per generated second (1280x720, 24 fps). */
export const DEFAULT_NOVA_REEL_CENTS_PER_SECOND = 8;
export const NOVA_REEL_SINGLE_SHOT_SECONDS = 6;
const TEXT_VIDEO_MAX_CHARS = 512;
const MULTI_SHOT_MAX_CHARS = 4000;
const OUTPUT_PREFIX = 'video-output';

type BedrockLike = { send: (command: unknown) => Promise<unknown> };

type AsyncInvokeSummary = {
  status?: string;
  failureMessage?: string;
  outputDataConfig?: { s3OutputDataConfig?: { s3Uri?: string } };
};

export function novaReelCentsPerSecond(): number {
  const parsed = Number(process.env.VIDEO_NOVA_REEL_CENTS_PER_SECOND);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_NOVA_REEL_CENTS_PER_SECOND;
}

function bedrockRegion() {
  return process.env.VIDEO_BEDROCK_REGION?.trim() || 'us-east-1';
}

const TRANSIENT_NAMES = new Set([
  'ThrottlingException',
  'ServiceUnavailableException',
  'InternalServerException',
  'ModelTimeoutException',
  'ModelNotReadyException',
  'TimeoutError',
  'RequestTimeout',
]);

function toProviderError(error: unknown): Error {
  const err = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const message = err?.message?.trim() || 'Amazon Bedrock request failed.';
  const status = err?.$metadata?.httpStatusCode;
  if ((err?.name && TRANSIENT_NAMES.has(err.name)) || (status !== undefined && status >= 500)) {
    return new TransientVideoError(message);
  }
  return new VideoConfigError(message);
}

/** "s3://bucket/a/b/inv" -> { bucket, prefix: "a/b/inv" } */
function parseS3Uri(uri: string): { bucket: string; prefix: string } | null {
  const match = /^s3:\/\/([^/]+)\/(.+?)\/?$/.exec(uri);
  return match ? { bucket: match[1], prefix: match[2] } : null;
}

export function createNovaReelProvider(options: { client?: BedrockLike } = {}): VideoProvider {
  let cached: BedrockLike | undefined = options.client;
  const client = () => (cached ??= new BedrockRuntimeClient({ region: bedrockRegion() }) as BedrockLike);

  return {
    id: NOVA_REEL_ID,
    label: 'Amazon Nova Reel',
    defaultModel: NOVA_REEL_MODEL,
    capabilities: {
      textToVideo: true,
      imageToVideo: true,
      videoToVideo: false,
      minSeconds: NOVA_REEL_SINGLE_SHOT_SECONDS,
      secondsStep: NOVA_REEL_SINGLE_SHOT_SECONDS,
      maxSeconds: 120,
      // A reference image only works with the 6 second single-shot task.
      imageToVideoMaxSeconds: NOVA_REEL_SINGLE_SHOT_SECONDS,
      aspectRatios: ['16:9'],
      qualityScore: 7,
    },

    isConfigured() {
      const storage = getVideoStorageConfig();
      if (!storage.ok) return storage;
      if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_PROFILE && !process.env.AWS_ROLE_ARN) {
        return { ok: false, reason: 'AWS credentials are not configured for Bedrock.' };
      }
      return { ok: true };
    },

    estimateCostCents(request) {
      return Math.ceil(request.seconds * novaReelCentsPerSecond());
    },

    validate(request) {
      if (request.mode === 'VIDEO') return 'Nova Reel does not support video-to-video.';
      if (request.aspect !== '16:9') return 'Nova Reel only produces 16:9 (1280x720) video.';
      if (!request.prompt.trim()) return 'A prompt is required.';
      const single = request.seconds === NOVA_REEL_SINGLE_SHOT_SECONDS;
      if (request.mode === 'IMAGE') {
        if (!request.inputImage) return 'A reference image is required.';
        if (!single) return 'Image-to-video is limited to 6 seconds.';
      }
      if (!single && (request.seconds < 12 || request.seconds > 120 || request.seconds % 6 !== 0)) {
        return 'Duration must be 6 seconds, or 12-120 seconds in 6 second steps.';
      }
      const limit = single ? TEXT_VIDEO_MAX_CHARS : MULTI_SHOT_MAX_CHARS;
      if (request.prompt.length > limit) {
        return `Prompt is too long for a ${request.seconds}s clip (max ${limit} characters).`;
      }
      return null;
    },

    async submit(request: VideoRequest) {
      const invalid = this.validate(request);
      if (invalid) throw new VideoConfigError(invalid);
      const storage = getVideoStorageConfig();
      if (!storage.ok) throw new VideoConfigError(storage.reason);

      const single = request.seconds === NOVA_REEL_SINGLE_SHOT_SECONDS;
      const dimension = '1280x720';
      const modelInput = single
        ? {
            taskType: 'TEXT_VIDEO',
            textToVideoParams: {
              text: request.prompt,
              ...(request.inputImage
                ? {
                    images: [
                      {
                        format: request.inputImage.format,
                        source: { bytes: request.inputImage.bytes.toString('base64') },
                      },
                    ],
                  }
                : {}),
            },
            videoGenerationConfig: { durationSeconds: 6, fps: 24, dimension },
          }
        : {
            taskType: 'MULTI_SHOT_AUTOMATED',
            multiShotAutomatedParams: { text: request.prompt },
            videoGenerationConfig: { durationSeconds: request.seconds, fps: 24, dimension },
          };

      try {
        const response = (await client().send(
          new StartAsyncInvokeCommand({
            modelId: request.model || NOVA_REEL_MODEL,
            modelInput: modelInput as never,
            clientRequestToken: request.idempotencyKey.slice(0, 256),
            outputDataConfig: {
              s3OutputDataConfig: {
                s3Uri: `s3://${storage.bucket}/${OUTPUT_PREFIX}/${request.idempotencyKey}`,
              },
            },
          }),
        )) as { invocationArn?: string };
        if (!response.invocationArn) {
          throw new TransientVideoError('Bedrock did not return an invocation id.');
        }
        return { externalId: response.invocationArn };
      } catch (error) {
        if (error instanceof TransientVideoError || error instanceof VideoConfigError) throw error;
        throw toProviderError(error);
      }
    },

    async poll(externalId): Promise<VideoPollResult> {
      let invoke: AsyncInvokeSummary;
      try {
        invoke = (await client().send(
          new GetAsyncInvokeCommand({ invocationArn: externalId }),
        )) as AsyncInvokeSummary;
      } catch (error) {
        throw toProviderError(error);
      }

      if (invoke.status === 'Completed') {
        const location = parseS3Uri(invoke.outputDataConfig?.s3OutputDataConfig?.s3Uri ?? '');
        if (!location) return { status: 'FAILED', error: 'Bedrock finished without an output location.' };
        return { status: 'SUCCEEDED', progress: 100, outputRef: `${location.prefix}/output.mp4` };
      }
      if (invoke.status === 'Failed') {
        return { status: 'FAILED', error: invoke.failureMessage?.trim() || 'Bedrock reported a failure.' };
      }
      // Bedrock only reports InProgress, so no percentage is available.
      return { status: 'RUNNING' };
    },

    async fetchResult(_externalId, outputRef) {
      if (!outputRef) throw new VideoConfigError('No output location was recorded.');
      const exists = await headVideoObject(outputRef);
      if (!exists) throw new TransientVideoError('The finished video is not in storage yet.');
      return { outputKey: outputRef, contentType: 'video/mp4' };
    },
  };
}
