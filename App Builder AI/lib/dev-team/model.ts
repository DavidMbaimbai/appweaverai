import { getAgentModelOption } from '@/lib/agent/model-catalog';
import { getAnthropicClient } from '@/lib/anthropic';

export type DevTeamModelCall = (call: {
  system: string;
  user: string;
  maxTokens: number;
  signal?: AbortSignal;
}) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;

/** The only place the dev team talks to a model. Tests inject a fake instead. */
export const defaultDevTeamModel: DevTeamModelCall = async ({ system, user, maxTokens, signal }) => {
  const response = await getAnthropicClient().messages.create(
    {
      model: getAgentModelOption('claude-sonnet').bedrockModelId,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    },
    { signal },
  );
  const block = response.content.find((c) => c.type === 'text');
  return {
    text: block && block.type === 'text' ? block.text : '',
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
};
