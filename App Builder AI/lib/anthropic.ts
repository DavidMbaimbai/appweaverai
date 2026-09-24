import type Anthropic from '@anthropic-ai/sdk';
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';

let client: Anthropic | null = null;

/**
 * All Claude calls are routed through Amazon Bedrock. Credentials are
 * resolved via the standard AWS SDK credential chain (env vars, shared
 * config/credentials files, or an IAM role) unless AWS_ACCESS_KEY_ID /
 * AWS_SECRET_ACCESS_KEY are set explicitly.
 */
export function getAnthropicClient(): Anthropic {
  if (client) return client;

  const awsRegion = process.env.AWS_REGION;
  if (!awsRegion) {
    throw new Error('AWS_REGION is not set (required for Amazon Bedrock).');
  }

  const awsAccessKey = process.env.AWS_ACCESS_KEY_ID;
  const awsSecretKey = process.env.AWS_SECRET_ACCESS_KEY;

  // `AnthropicBedrock` mirrors the `Anthropic` client's `messages` API, so
  // it's safe to treat it as one for callers that only use that surface.
  client = (
    awsAccessKey && awsSecretKey
      ? new AnthropicBedrock({
          awsRegion,
          awsAccessKey,
          awsSecretKey,
          awsSessionToken: process.env.AWS_SESSION_TOKEN,
        })
      : new AnthropicBedrock({ awsRegion })
  ) as unknown as Anthropic;
  return client;
}
