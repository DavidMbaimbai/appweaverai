import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { hasProjectAccess } from '@/lib/projects/access';
import { prisma } from '@/lib/prisma';
import {
  TERMINAL_ALLOWED_COMMANDS,
  findTerminalCommand,
} from '@/lib/code-run/terminal-commands';
import { runTerminalCommand } from '@/lib/code-run/run-terminal-command';

type TerminalStreamEvent =
  | { type: 'output'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'done'; exitCode: number | null; timedOut: boolean }
  | { type: 'error'; message: string };

function encodeSse(event: TerminalStreamEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Streams the output of one allow-listed terminal command (see
 * lib/code-run/terminal-commands.ts) as it runs inside a sandboxed,
 * resource-capped Docker container rooted at a scratch copy of the
 * artifact's files. The typed command is matched verbatim against the
 * allow-list server-side — arbitrary input is rejected before anything is
 * ever spawned, so there is no shell-injection surface even though the UI
 * feels like a real terminal.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; artifactSlug: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
    });
  }

  const { projectId, artifactSlug } = await context.params;

  const allowed = await hasProjectAccess(projectId, userId);
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
    });
  }

  const artifact = await prisma.artifact.findFirst({
    where: { projectId, slug: artifactSlug },
    select: { id: true },
  });
  if (!artifact) {
    return new Response(JSON.stringify({ error: 'Artifact not found.' }), {
      status: 404,
    });
  }

  const json = await request.json().catch(() => null);
  const raw = typeof json?.command === 'string' ? json.command : '';

  if (raw.trim().toLowerCase() === 'help') {
    return Response.json({
      commands: TERMINAL_ALLOWED_COMMANDS.filter((c) => c.input !== 'help'),
    });
  }

  const command = findTerminalCommand(raw);
  if (!command) {
    return new Response(
      JSON.stringify({
        error: `"${raw}" isn't a supported command. Type "help" to see what's available.`,
      }),
      { status: 400 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      function send(event: TerminalStreamEvent) {
        controller.enqueue(encoder.encode(encodeSse(event)));
      }

      try {
        const result = await runTerminalCommand(
          projectId,
          artifactSlug,
          command,
          (text, streamName) => {
            send({ type: 'output', stream: streamName, text });
          },
        );
        send({
          type: 'done',
          exitCode: result.exitCode,
          timedOut: result.timedOut,
        });
      } catch (error) {
        send({
          type: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to run the command.',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
