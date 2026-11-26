import type Anthropic from '@anthropic-ai/sdk';
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';

import { runBedrockConverseTurn } from '@/lib/agent/bedrock-converse';
import {
  AGENT_MODEL_OPTIONS,
  getNextAgentModelOption,
} from '@/lib/agent/model-catalog';

let client: Anthropic | null = null;
let rotatingClient: Anthropic | null = null;

/**
 * All text-generation calls are rotated across the configured Bedrock models.
 * Credentials are
 * resolved via the standard AWS SDK credential chain (env vars, shared
 * config/credentials files, or an IAM role) unless AWS_ACCESS_KEY_ID /
 * AWS_SECRET_ACCESS_KEY are set explicitly.
 */
export function getAnthropicClient(): Anthropic {
  if (rotatingClient) return rotatingClient;

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

  const baseClient = client;
  rotatingClient = new Proxy(baseClient, {
    get(target, property, receiver) {
      if (property !== 'messages') {
        return Reflect.get(target, property, receiver);
      }

      return {
        create: async (params: Parameters<Anthropic['messages']['create']>[0]) => {
          // Streaming is reserved for the agent loop, which has its own
          // provider-aware execution path.
          if ('stream' in params && params.stream) {
            return baseClient.messages.create(params);
          }

          let lastError: unknown;
          const startIndex = AGENT_MODEL_OPTIONS.indexOf(
            getNextAgentModelOption(),
          );

          for (let offset = 0; offset < AGENT_MODEL_OPTIONS.length; offset += 1) {
            const option =
              AGENT_MODEL_OPTIONS[
                (startIndex + offset) % AGENT_MODEL_OPTIONS.length
              ];

            try {
              if (option.provider === 'anthropic') {
                return await baseClient.messages.create({
                  ...params,
                  model: option.bedrockModelId,
                });
              }

              const system =
                typeof params.system === 'string'
                  ? params.system
                  : (params.system ?? [])
                      .map((block) => ('text' in block ? block.text : ''))
                      .join('\n');

              return await runBedrockConverseTurn({
                model: option.bedrockModelId,
                system,
                messages: params.messages,
                tools: (params.tools ?? []) as Anthropic.Tool[],
                maxTokens: params.max_tokens,
              });
            } catch (error) {
              lastError = error;
            }
          }

          throw lastError instanceof Error
            ? lastError
            : new Error('All configured AI models failed.');
        },
      };
    },
  }) as Anthropic;

  return rotatingClient;
}
