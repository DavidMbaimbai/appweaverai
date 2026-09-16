export type TerminalStreamEvent =
  | { type: 'output'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'done'; exitCode: number | null; timedOut: boolean }
  | { type: 'error'; message: string };

type StreamTerminalOptions = {
  projectId: string;
  artifactSlug: string;
  command: string;
  onEvent: (event: TerminalStreamEvent) => void;
};

/**
 * Client-side SSE reader for the sandboxed terminal endpoint. Mirrors
 * lib/agent/stream-client.ts's manual chunk-parsing approach (fetch + a
 * ReadableStream reader) rather than EventSource, since we need to POST a
 * body (the command) to start the stream.
 */
export async function streamTerminalCommand({
  projectId,
  artifactSlug,
  command,
  onEvent,
}: StreamTerminalOptions) {
  const response = await fetch(
    `/api/projects/${projectId}/artifacts/${artifactSlug}/terminal`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    },
  );

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(errorBody?.error ?? 'Terminal request failed.');
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
      let dataLine = '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          dataLine = line.slice(6);
        }
      }

      if (!dataLine) continue;

      const parsed = JSON.parse(dataLine) as TerminalStreamEvent;
      onEvent(parsed);
    }
  }
}
