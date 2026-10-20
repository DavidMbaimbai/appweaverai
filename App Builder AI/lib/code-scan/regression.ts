import { prisma } from '@/lib/prisma';
import { readProjectFile } from '@/lib/project-files';
import type { TerminalCommand } from '@/lib/code-run/terminal-commands';

import { redactLogForDiagnosis } from './redact';

export type RegressionStatus = 'PASSED' | 'FAILED' | 'NOT_RUN';

export type RegressionPlan =
  | { runnable: true; artifactSlug: string; script: 'test' | 'build'; label: string; command: TerminalCommand }
  | { runnable: false; reason: string };

export type StoredRegression = {
  id: string;
  createdAt: string;
  status: RegressionStatus;
  command: string | null;
  output: string | null;
};

const PLACEHOLDER_TEST = /no test specified|echo\s+["']?error/i;

function parseScripts(packageJson: string | null): Record<string, string> | null {
  if (!packageJson) return null;
  try {
    const parsed = JSON.parse(packageJson) as { scripts?: Record<string, unknown> };
    const entries = Object.entries(parsed.scripts ?? {}).filter(([, v]) => typeof v === 'string');
    return Object.fromEntries(entries) as Record<string, string>;
  } catch {
    return null;
  }
}

/** Chooses what to run: a real `test` script first, otherwise `build`. Commands are fixed literals, never built from project content. */
export function planRegression(artifacts: Array<{ slug: string; packageJson: string | null }>): RegressionPlan {
  const withScripts = artifacts
    .map((a) => ({ slug: a.slug, scripts: parseScripts(a.packageJson) }))
    .filter((a): a is { slug: string; scripts: Record<string, string> } => a.scripts !== null);
  if (withScripts.length === 0) return { runnable: false, reason: 'No package.json was found, so there is nothing to test or build.' };

  const testable = withScripts.find((a) => a.scripts.test && !PLACEHOLDER_TEST.test(a.scripts.test));
  if (testable) {
    return {
      runnable: true,
      artifactSlug: testable.slug,
      script: 'test',
      label: 'npm install && npm test',
      command: {
        input: 'regression: npm test',
        description: 'Install dependencies and run the project tests',
        argv: ['sh', '-c', 'npm install --no-audit --no-fund && npm test'],
        needsNetwork: true,
      },
    };
  }
  const buildable = withScripts.find((a) => a.scripts.build);
  if (buildable) {
    return {
      runnable: true,
      artifactSlug: buildable.slug,
      script: 'build',
      label: 'npm install && npm run build',
      command: {
        input: 'regression: npm run build',
        description: 'Install dependencies and run the project build',
        argv: ['sh', '-c', 'npm install --no-audit --no-fund && npm run build'],
        needsNetwork: true,
      },
    };
  }
  return { runnable: false, reason: 'package.json has no test script and no build script to run.' };
}

export type SandboxOutcome = { exitCode: number | null; timedOut: boolean; error?: string };

/** Pass/fail only on a real exit code. Anything that stopped the command from finishing is NOT_RUN, never a pass. */
export function classifyRegression(outcome: SandboxOutcome): { status: RegressionStatus; note: string | null } {
  if (outcome.error) return { status: 'NOT_RUN', note: `The sandbox could not start (${outcome.error}). Nothing was verified.` };
  if (outcome.timedOut) return { status: 'NOT_RUN', note: 'The check did not finish within the time limit. Nothing was verified.' };
  if (outcome.exitCode === null) return { status: 'NOT_RUN', note: 'The check ended without an exit code. Nothing was verified.' };
  if (outcome.exitCode === 0) return { status: 'PASSED', note: null };
  return { status: 'FAILED', note: `Exited with code ${outcome.exitCode}.` };
}

export type SandboxRunner = (
  projectId: string,
  artifactSlug: string,
  command: TerminalCommand,
  onData: (chunk: string, stream: 'stdout' | 'stderr') => void,
) => Promise<SandboxOutcome>;

async function defaultRunner(...args: Parameters<SandboxRunner>): Promise<SandboxOutcome> {
  const { runTerminalCommand } = await import('@/lib/code-run/run-terminal-command');
  return runTerminalCommand(...args);
}

async function loadArtifacts(projectId: string) {
  const artifacts = await prisma.artifact.findMany({ where: { projectId }, select: { slug: true } });
  return Promise.all(
    artifacts.map(async (a) => ({
      slug: a.slug,
      packageJson: await readProjectFile(projectId, a.slug, 'package.json').catch(() => null),
    })),
  );
}

function toStored(run: {
  id: string;
  createdAt: Date;
  regressionStatus: string | null;
  regressionCommand: string | null;
  regressionOutput: string | null;
}): StoredRegression {
  return {
    id: run.id,
    createdAt: run.createdAt.toISOString(),
    status: (run.regressionStatus as RegressionStatus | null) ?? 'NOT_RUN',
    command: run.regressionCommand,
    output: run.regressionOutput,
  };
}

/** Runs the project's own tests (or build) in the Docker sandbox and records the result. Unavailable sandbox => NOT_RUN. */
export async function runRegressionCheck(input: {
  projectId: string;
  userId?: string | null;
  runner?: SandboxRunner;
  artifacts?: Array<{ slug: string; packageJson: string | null }>;
}): Promise<StoredRegression> {
  const plan = planRegression(input.artifacts ?? (await loadArtifacts(input.projectId)));
  let status: RegressionStatus = 'NOT_RUN';
  let output = '';
  let command: string | null = null;

  if (!plan.runnable) {
    output = plan.reason;
  } else {
    command = plan.label;
    let captured = '';
    try {
      const outcome = await (input.runner ?? defaultRunner)(input.projectId, plan.artifactSlug, plan.command, (chunk) => {
        if (captured.length < 200_000) captured += chunk;
      });
      const result = classifyRegression(outcome);
      status = result.status;
      output = [redactLogForDiagnosis(captured), result.note].filter(Boolean).join('\n\n');
    } catch {
      status = 'NOT_RUN';
      output = 'The sandbox failed unexpectedly. Nothing was verified.';
    }
  }

  const run = await prisma.scanRun.create({
    data: {
      projectId: input.projectId,
      triggeredById: input.userId ?? null,
      trigger: 'REGRESSION',
      kind: 'REGRESSION',
      regressionStatus: status,
      regressionCommand: command,
      regressionOutput: output.slice(0, 12_000),
    },
  });
  return toStored(run);
}

export async function getLatestRegression(projectId: string): Promise<StoredRegression | null> {
  const run = await prisma.scanRun.findFirst({ where: { projectId, kind: 'REGRESSION' }, orderBy: { createdAt: 'desc' } });
  return run ? toStored(run) : null;
}
