import { getAnthropicModel } from '@/lib/agent/constants';

/**
 * Bedrock-hosted Claude variants the agent chat lets users pick between,
 * mirroring Cursor's model picker but scoped to what AWS Bedrock actually
 * hosts (Anthropic only — no GPT/Gemini/Grok). Selection is free-for-all:
 * every tier can pick any option, it only changes which model answers.
 */
export type AgentModelId = 'claude-sonnet' | 'claude-opus' | 'claude-haiku';

export type AgentModelOption = {
  id: AgentModelId;
  label: string;
  description: string;
  bedrockModelId: string;
};

const DEFAULT_OPUS_MODEL = 'eu.anthropic.claude-opus-4-1-20250805-v1:0';
const DEFAULT_HAIKU_MODEL = 'eu.anthropic.claude-3-5-haiku-20241022-v1:0';

function readModelEnv(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

export const DEFAULT_AGENT_MODEL_ID: AgentModelId = 'claude-sonnet';

export const AGENT_MODEL_OPTIONS: AgentModelOption[] = [
  {
    id: 'claude-sonnet',
    label: 'Claude Sonnet',
    description: 'Best balance of speed and intelligence. Recommended default.',
    bedrockModelId: getAnthropicModel(),
  },
  {
    id: 'claude-opus',
    label: 'Claude Opus',
    description: 'Most capable. Slower — best for complex, multi-file builds.',
    bedrockModelId: readModelEnv(
      process.env.BEDROCK_MODEL_ID_OPUS,
      DEFAULT_OPUS_MODEL,
    ),
  },
  {
    id: 'claude-haiku',
    label: 'Claude Haiku',
    description: 'Fastest and most economical — best for quick edits.',
    bedrockModelId: readModelEnv(
      process.env.BEDROCK_MODEL_ID_HAIKU,
      DEFAULT_HAIKU_MODEL,
    ),
  },
];

export function resolveAgentModelId(
  value: string | null | undefined,
): AgentModelId {
  return AGENT_MODEL_OPTIONS.some((option) => option.id === value)
    ? (value as AgentModelId)
    : DEFAULT_AGENT_MODEL_ID;
}

export function getAgentModelOption(id: AgentModelId): AgentModelOption {
  return (
    AGENT_MODEL_OPTIONS.find((option) => option.id === id) ??
    AGENT_MODEL_OPTIONS[0]
  );
}
