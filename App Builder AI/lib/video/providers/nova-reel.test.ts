import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/video/storage', () => ({
  getVideoStorageConfig: () => ({ ok: true, bucket: 'vid-bucket', region: 'us-east-1' }),
  headVideoObject: vi.fn(async () => true),
}));

import { createNovaReelProvider } from '@/lib/video/providers/nova-reel';
import { TransientVideoError, VideoConfigError } from '@/lib/video/providers/types';

const request = {
  mode: 'TEXT' as const,
  prompt: 'A drone shot over a coastal town at sunrise',
  seconds: 6,
  aspect: '16:9' as const,
  idempotencyKey: 'job-123',
};

function mockClient(impl: (input: unknown) => unknown) {
  const send = vi.fn(async (command: unknown) => impl((command as { input: unknown }).input));
  return { send, client: { send } };
}

type Sent = {
  modelId: string;
  clientRequestToken: string;
  outputDataConfig: { s3OutputDataConfig: { s3Uri: string } };
  modelInput: {
    taskType: string;
    textToVideoParams: { images: unknown[] };
    multiShotAutomatedParams: { text: string };
    videoGenerationConfig: { durationSeconds: number; dimension: string };
  };
};

const sentInput = (send: { mock: { calls: unknown[][] } }) =>
  (send.mock.calls[0][0] as { input: Sent }).input;

beforeEach(() => {
  delete process.env.VIDEO_NOVA_REEL_CENTS_PER_SECOND;
});

describe('nova reel submit', () => {
  it('starts a single-shot TEXT_VIDEO job with an idempotent token and S3 output', async () => {
    const { send, client } = mockClient(() => ({ invocationArn: 'arn:aws:bedrock:us-east-1:1:async-invoke/abc' }));
    const result = await createNovaReelProvider({ client }).submit(request);
    expect(result.externalId).toContain('async-invoke/abc');
    const input = sentInput(send);
    expect(input.modelId).toBe('amazon.nova-reel-v1:1');
    expect(input.clientRequestToken).toBe('job-123');
    expect(input.outputDataConfig.s3OutputDataConfig.s3Uri).toBe('s3://vid-bucket/video-output/job-123');
    expect(input.modelInput.taskType).toBe('TEXT_VIDEO');
    expect(input.modelInput.videoGenerationConfig).toMatchObject({ durationSeconds: 6, dimension: '1280x720' });
  });

  it('uses MULTI_SHOT_AUTOMATED for longer clips', async () => {
    const { send, client } = mockClient(() => ({ invocationArn: 'arn:x' }));
    await createNovaReelProvider({ client }).submit({ ...request, seconds: 24 });
    const input = sentInput(send);
    expect(input.modelInput.taskType).toBe('MULTI_SHOT_AUTOMATED');
    expect(input.modelInput.multiShotAutomatedParams.text).toBe(request.prompt);
    expect(input.modelInput.videoGenerationConfig.durationSeconds).toBe(24);
  });

  it('sends the reference image for image-to-video', async () => {
    const { send, client } = mockClient(() => ({ invocationArn: 'arn:x' }));
    await createNovaReelProvider({ client }).submit({
      ...request,
      mode: 'IMAGE',
      inputImage: { format: 'png', bytes: Buffer.from('png-bytes') },
    });
    const input = sentInput(send);
    expect(input.modelInput.textToVideoParams.images[0]).toEqual({
      format: 'png',
      source: { bytes: Buffer.from('png-bytes').toString('base64') },
    });
  });

  it('rejects unsupported requests without calling Bedrock', async () => {
    const { send, client } = mockClient(() => ({}));
    const provider = createNovaReelProvider({ client });
    await expect(provider.submit({ ...request, seconds: 7 })).rejects.toBeInstanceOf(VideoConfigError);
    await expect(provider.submit({ ...request, prompt: 'x'.repeat(513) })).rejects.toBeInstanceOf(VideoConfigError);
    await expect(
      provider.submit({ ...request, mode: 'IMAGE', seconds: 12, inputImage: { format: 'png', bytes: Buffer.alloc(1) } }),
    ).rejects.toBeInstanceOf(VideoConfigError);
    expect(send).not.toHaveBeenCalled();
  });

  it('classifies throttling as transient and validation errors as permanent', async () => {
    const throttled = createNovaReelProvider({
      client: { send: async () => Promise.reject(Object.assign(new Error('slow down'), { name: 'ThrottlingException' })) },
    });
    await expect(throttled.submit(request)).rejects.toBeInstanceOf(TransientVideoError);
    const invalid = createNovaReelProvider({
      client: { send: async () => Promise.reject(Object.assign(new Error('bad input'), { name: 'ValidationException' })) },
    });
    await expect(invalid.submit(request)).rejects.toMatchObject({ message: 'bad input', transient: false });
  });
});

describe('nova reel poll', () => {
  it('maps InProgress to RUNNING without inventing progress', async () => {
    const { client } = mockClient(() => ({ status: 'InProgress' }));
    expect(await createNovaReelProvider({ client }).poll('arn:x')).toEqual({ status: 'RUNNING' });
  });

  it('maps Completed to SUCCEEDED with the output object key', async () => {
    const { client } = mockClient(() => ({
      status: 'Completed',
      outputDataConfig: { s3OutputDataConfig: { s3Uri: 's3://vid-bucket/video-output/job-123/inv9' } },
    }));
    const provider = createNovaReelProvider({ client });
    const polled = await provider.poll('arn:x');
    expect(polled).toMatchObject({ status: 'SUCCEEDED', progress: 100, outputRef: 'video-output/job-123/inv9/output.mp4' });
    expect(await provider.fetchResult('arn:x', polled.outputRef)).toEqual({
      outputKey: 'video-output/job-123/inv9/output.mp4',
      contentType: 'video/mp4',
    });
  });

  it('surfaces the provider failure message', async () => {
    const { client } = mockClient(() => ({ status: 'Failed', failureMessage: 'Content filtered' }));
    expect(await createNovaReelProvider({ client }).poll('arn:x')).toEqual({
      status: 'FAILED',
      error: 'Content filtered',
    });
  });
});

describe('nova reel cost', () => {
  it('estimates 8 cents per second by default and honours the override', () => {
    const provider = createNovaReelProvider({ client: { send: vi.fn() } });
    expect(provider.estimateCostCents({ mode: 'TEXT', seconds: 6 })).toBe(48);
    process.env.VIDEO_NOVA_REEL_CENTS_PER_SECOND = '10';
    expect(provider.estimateCostCents({ mode: 'TEXT', seconds: 12 })).toBe(120);
  });
});
