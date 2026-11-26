import type { AgentStreamEvent } from '@/lib/agent/types';

type StreamAgentOptions = {
  projectId: string;
  artifactId: string;
  content?: string;
  conversationId?: string | null;
  initialReply?: boolean;
  onEvent: (event: AgentStreamEvent) => void;
};

export async function streamAgentRequest({
  projectId,
  artifactId,
  content,
  conversationId,
  initialReply,
  onEvent,
}: StreamAgentOptions) {
  const response = await fetch(`/api/projects/${projectId}/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      artifactId,
      content,
      conversationId: conversationId ?? undefined,
      initialReply: initialReply ?? false,
    }),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(errorBody?.error ?? 'Agent request failed.');
  }

  if (!response.body) {
    throw new Error('No response stream.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';

    for (const chunk of chunks) {
      const lines = chunk.split('\n');
      let eventType = 'message';
      let dataLine = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          dataLine = line.slice(6);
        }
      }

      if (!dataLine) continue;

      const parsed = JSON.parse(dataLine) as AgentStreamEvent;
      if (parsed.type === eventType || parsed.type) {
        onEvent(parsed);
      }
    }
  }
}
