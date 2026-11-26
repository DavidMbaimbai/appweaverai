import { getAnthropicModel } from '@/lib/agent/constants';

/** Models available to the agent chat through Amazon Bedrock. */
export type AgentModelId =
  | 'claude-sonnet'
  | 'claude-opus'
  | 'claude-haiku'
  | 'nova-pro'
  | 'nova-lite';
export type AgentModelProvider = 'anthropic' | 'bedrock-converse';

export type AgentModelOption = {
  id: AgentModelId;
  label: string;
  description: string;
  bedrockModelId: string;
  provider: AgentModelProvider;
};

const DEFAULT_OPUS_MODEL = 'eu.anthropic.claude-opus-4-1-20250805-v1:0';
const DEFAULT_HAIKU_MODEL = 'eu.anthropic.claude-3-5-haiku-20241022-v1:0';
const DEFAULT_NOVA_PRO_MODEL = 'amazon.nova-pro-v1:0';
const DEFAULT_NOVA_LITE_MODEL = 'amazon.nova-lite-v1:0';

function readModelEnv(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

export const DEFAULT_AGENT_MODEL_ID: AgentModelId = 'claude-sonnet';

export const AGENT_MODEL_OPTIONS: AgentModelOption[] = [
  {
    id: 'claude-sonnet',
    label: 'Claude Sonnet 4.5',
    description: 'Anthropic Claude Sonnet 4.5. Recommended default.',
    bedrockModelId: getAnthropicModel(),
    provider: 'anthropic',
  },
  {
    id: 'claude-opus',
    label: 'Claude Opus 4.1',
    description: 'Anthropic Claude Opus 4.1. Best for complex builds.',
    bedrockModelId: readModelEnv(
      process.env.BEDROCK_MODEL_ID_OPUS,
      DEFAULT_OPUS_MODEL,
    ),
    provider: 'anthropic',
  },
  {
    id: 'claude-haiku',
    label: 'Claude Haiku 3.5',
    description: 'Anthropic Claude Haiku 3.5. Fast and economical.',
    bedrockModelId: readModelEnv(
      process.env.BEDROCK_MODEL_ID_HAIKU,
      DEFAULT_HAIKU_MODEL,
    ),
    provider: 'anthropic',
  },
  {
    id: 'nova-pro',
    label: 'Amazon Nova Pro 1.0',
    description: 'Amazon Nova Pro v1.0. Strong general-purpose alternative.',
    bedrockModelId: readModelEnv(
      process.env.BEDROCK_MODEL_ID_NOVA_PRO,
      DEFAULT_NOVA_PRO_MODEL,
    ),
    provider: 'bedrock-converse',
  },
  {
    id: 'nova-lite',
    label: 'Amazon Nova Lite 1.0',
    description: 'Amazon Nova Lite v1.0. Fast and cost-efficient.',
    bedrockModelId: readModelEnv(
      process.env.BEDROCK_MODEL_ID_NOVA_LITE,
      DEFAULT_NOVA_LITE_MODEL,
    ),
    provider: 'bedrock-converse',
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
