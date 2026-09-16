import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { artifactWorkspaceDir } from '@/lib/project-files';
import type { TerminalCommand } from '@/lib/code-run/terminal-commands';

const RUN_TIMEOUT_MS = 60_000;
const TERMINAL_IMAGE = 'node:20';

export type TerminalRunOutcome = {
  exitCode: number | null;
  timedOut: boolean;
  error?: string;
};

/**
 * Runs one pre-approved terminal command (see terminal-commands.ts) inside a
 * throwaway Docker container: a scratch copy of the artifact's own files
 * (never the real workspace, so a failed/broken install or build can't
 * corrupt the project), streamed to the caller chunk-by-chunk via onData as
 * it produces output, then torn down. Mirrors lib/code-run/run-code.ts's
 * sandboxing approach (network isolation by default, memory/cpu/pid caps,
 * hard timeout) but keeps the container alive as an interactive-feeling
 * command runner rather than a single "run the program" execution.
 */
export async function runTerminalCommand(
  projectId: string,
  artifactSlug: string,
  command: TerminalCommand,
  onData: (chunk: string, stream: 'stdout' | 'stderr') => void,
): Promise<TerminalRunOutcome> {
  const sourceDir = artifactWorkspaceDir(projectId, artifactSlug);
  const containerName = `aw-term-${randomUUID()}`;

  let tempDir: string | null = null;
  try {
    tempDir = await mkdtemp(path.join(tmpdir(), 'aw-term-'));

    try {
      await cp(sourceDir, tempDir, { recursive: true });
    } catch {
      await mkdir(tempDir, { recursive: true });
    }

    const dockerArgs = [
      'run',
      '--rm',
      `--name=${containerName}`,
      command.needsNetwork ? '--network=bridge' : '--network=none',
      '--memory=512m',
      '--cpus=1',
      '--pids-limit=256',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '-v',
      `${tempDir}:/workspace`,
      '-w',
      '/workspace',
      TERMINAL_IMAGE,
      ...command.argv,
    ];

    return await new Promise<TerminalRunOutcome>((resolve) => {
      let timedOut = false;

      const child = spawn('docker', dockerArgs, { windowsHide: true });

      const timer = setTimeout(() => {
        timedOut = true;
        spawn('docker', ['kill', containerName], { windowsHide: true });
      }, RUN_TIMEOUT_MS);

      child.stdout.on('data', (chunk: Buffer) => {
        onData(chunk.toString(), 'stdout');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        onData(chunk.toString(), 'stderr');
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        onData(`Failed to start sandbox: ${error.message}\n`, 'stderr');
        resolve({ exitCode: null, timedOut: false, error: error.message });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          onData('\n[Killed: exceeded time limit]\n', 'stderr');
        }
        resolve({ exitCode: code, timedOut });
      });
    });
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
