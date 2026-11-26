import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import type Anthropic from '@anthropic-ai/sdk';
import type { DocumentType } from '@smithy/types';

let client: BedrockRuntimeClient | null = null;

function getClient() {
  if (client) return client;
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error('AWS_REGION is not configured (required for Amazon Bedrock).');
  }
  client = new BedrockRuntimeClient({ region });
  return client;
}

function toConverseBlocks(
  content: Anthropic.MessageParam['content'],
): ContentBlock[] {
  if (typeof content === 'string') return [{ text: content }];

  return content.flatMap((block): ContentBlock[] => {
    if (block.type === 'text') return [{ text: block.text }];

    if (block.type === 'image' && block.source.type === 'base64') {
      const format = block.source.media_type.replace('image/', '') as
        | 'png'
        | 'jpeg'
        | 'gif'
        | 'webp';
      return [
        {
          image: {
            format,
            source: { bytes: Buffer.from(block.source.data, 'base64') },
          },
        },
      ];
    }

    if (block.type === 'tool_use') {
      return [
        {
          toolUse: {
            toolUseId: block.id,
            name: block.name,
            input: block.input as DocumentType,
          },
        },
      ];
    }

    if (block.type === 'tool_result') {
      const resultContent =
        typeof block.content === 'string'
          ? block.content
          : (block.content ?? [])
              .filter((item) => item.type === 'text')
              .map((item) => item.text)
              .join('\n');
      return [
        {
          toolResult: {
            toolUseId: block.tool_use_id,
            content: [{ text: resultContent }],
          },
        },
      ];
    }

    return [];
  });
}

function toConverseMessages(
  messages: Anthropic.MessageParam[],
): Message[] {
  return messages.map((message) => ({
    role: message.role,
    content: toConverseBlocks(message.content),
  }));
}

function toConverseTools(tools: Anthropic.Tool[]): Tool[] {
  return tools.map((tool) => ({
    toolSpec: {
      name: tool.name,
      description: tool.description,
      inputSchema: { json: tool.input_schema as DocumentType },
    },
  }));
}

function toAnthropicContent(content: ContentBlock[] | undefined): Anthropic.ContentBlock[] {
  return (content ?? []).flatMap((block): Anthropic.ContentBlock[] => {
    if ('text' in block && block.text) {
      return [{ type: 'text', text: block.text, citations: null }];
    }
    if ('toolUse' in block && block.toolUse?.toolUseId && block.toolUse.name) {
      return [
        {
          type: 'tool_use',
          id: block.toolUse.toolUseId,
          name: block.toolUse.name,
          input: block.toolUse.input ?? {},
          caller: { type: 'direct' },
        },
      ];
    }
    return [];
  });
}

export async function runBedrockConverseTurn({
  model,
  system,
  messages,
  tools,
  maxTokens,
  onText,
}: {
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  maxTokens: number;
  onText?: (text: string) => void;
}): Promise<Anthropic.Message> {
  const response = await getClient().send(
    new ConverseCommand({
      modelId: model,
      system: system ? [{ text: system }] : undefined,
      messages: toConverseMessages(messages),
      inferenceConfig: { maxTokens },
      ...(tools.length > 0
        ? { toolConfig: { tools: toConverseTools(tools) } }
        : {}),
    }),
  );
  const content = toAnthropicContent(response.output?.message?.content);
  const text = content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  if (text) onText?.(text);

  return {
    id: `converse-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model,
    container: null,
    stop_reason: response.stopReason === 'tool_use' ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      input_tokens: response.usage?.inputTokens ?? 0,
      output_tokens: response.usage?.outputTokens ?? 0,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
    },
  };
}
