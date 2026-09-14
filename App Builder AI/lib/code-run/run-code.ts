import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { artifactWorkspaceDir } from '@/lib/project-files';
import { CODE_LANGUAGES, type CodeLanguageId } from '@/lib/code-run/languages';

const RUN_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_CHARS = 20_000;

export type RunCodeResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  error?: string;
};

function truncate(text: string) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n… (output truncated)`;
}

/**
 * Runs a plain-code artifact's entry file inside a throwaway, network-isolated
 * Docker container and returns its captured stdout/stderr. This is the "live
 * running preview" for non-web programming languages — Python, Java, Go, C,
 * C++, Rust, Ruby, PHP, C#, and TypeScript (via Deno) all execute for real,
 * they aren't simulated.
 */
export async function runCode(
  projectId: string,
  artifactSlug: string,
  languageId: CodeLanguageId,
): Promise<RunCodeResult> {
  const language = CODE_LANGUAGES[languageId];
  const sourceDir = artifactWorkspaceDir(projectId, artifactSlug);
  const containerName = `aw-run-${randomUUID()}`;

  let tempDir: string | null = null;
  try {
    tempDir = await mkdtemp(path.join(tmpdir(), 'aw-run-'));

    try {
      await cp(sourceDir, tempDir, { recursive: true });
    } catch {
      return {
        stdout: '',
        stderr: '',
        exitCode: null,
        timedOut: false,
        error: 'No files found for this artifact yet — ask the agent to build it first.',
      };
    }

    const dockerArgs = [
      'run',
      '--rm',
      `--name=${containerName}`,
      '--network=none',
      '--memory=256m',
      '--cpus=1',
      '--pids-limit=128',
      '-v',
      `${tempDir}:/workspace`,
      '-w',
      '/workspace',
      language.image,
      'sh',
      '-c',
      language.command,
    ];

    return await new Promise<RunCodeResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child = spawn('docker', dockerArgs, { windowsHide: true });

      const timer = setTimeout(() => {
        timedOut = true;
        spawn('docker', ['kill', containerName], { windowsHide: true });
      }, RUN_TIMEOUT_MS);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({
          stdout: truncate(stdout),
          stderr: truncate(stderr),
          exitCode: null,
          timedOut: false,
          error: `Failed to start Docker: ${error.message}`,
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          stdout: truncate(stdout),
          stderr: truncate(stderr) + (timedOut ? '\n\n[Killed: exceeded time limit]' : ''),
          exitCode: code,
          timedOut,
        });
      });
    });
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
