import { spawn } from 'node:child_process';
import { cp, lchown, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { artifactWorkspaceDir } from '@/lib/project-files';
import {
  connectionEnvFromUrl,
  isManagedDatabaseConfigured,
  provisionProjectDatabase,
} from '@/lib/databases/provision';
import { listWorkspaceRelativePaths } from '@/lib/preview/list-workspace-paths';
import {
  BACKEND_RUNTIMES,
  detectBackend,
  type BackendRuntime,
  type DetectedBackend,
} from '@/lib/backend-preview/runtimes';

/** Hard cap on how long a preview container may live. */
const MAX_LIFETIME_SECONDS = 30 * 60;
const TEST_TIMEOUT_SECONDS = 5 * 60;

async function chownTree(target: string, uid: number): Promise<void> {
  await lchown(target, uid, uid);
  const entries = await readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) await chownTree(child, uid);
    else await lchown(child, uid, uid);
  }
}
const MAX_CONCURRENT = Number(process.env.BACKEND_PREVIEW_MAX ?? 5);

export type BackendStatus = {
  enabled: boolean;
  detected: { kind: string; label: string } | null;
  state: 'none' | 'starting' | 'running' | 'stopped';
  ready: boolean;
  port: number | null;
  logs: string;
};

export function isBackendPreviewEnabled() {
  return process.env.BACKEND_PREVIEW_ENABLED === 'true';
}

function containerName(projectId: string, artifactSlug: string) {
  return `aw-be-${projectId}-${artifactSlug}`.replace(/[^a-zA-Z0-9_.-]/g, '-');
}

function workDir(name: string) {
  return path.join(tmpdir(), 'aw-backend-preview', name);
}

function docker(args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      let stdout = '';
      let stderr = '';
      const child = spawn('docker', args, { windowsHide: true });
      child.stdout.on('data', (c) => (stdout += c.toString()));
      child.stderr.on('data', (c) => (stderr += c.toString()));
      child.on('error', (error) =>
        resolve({ code: null, stdout, stderr: error.message }),
      );
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    },
  );
}

async function inspect(name: string) {
  const { code, stdout } = await docker([
    'inspect',
    '--format',
    '{{.State.Running}}',
    name,
  ]);
  if (code !== 0) return 'none' as const;
  return stdout.trim() === 'true' ? ('running' as const) : ('stopped' as const);
}

/** Host port Docker published for the container, or null. */
export async function getBackendHostPort(
  projectId: string,
  artifactSlug: string,
  containerPort: number,
) {
  const { code, stdout } = await docker([
    'port',
    containerName(projectId, artifactSlug),
    `${containerPort}/tcp`,
  ]);
  if (code !== 0) return null;
  const match = stdout.match(/:(\d+)\s*$/m);
  return match ? Number(match[1]) : null;
}

async function isReachable(port: number) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(1500),
    });
    return true;
  } catch {
    return false;
  }
}

export async function getBackendStatus(
  projectId: string,
  artifactSlug: string,
): Promise<BackendStatus> {
  const backend = detectBackend(
    await listWorkspaceRelativePaths(projectId, artifactSlug),
  );
  const base: BackendStatus = {
    enabled: isBackendPreviewEnabled(),
    detected: backend
      ? { kind: backend.kind, label: BACKEND_RUNTIMES[backend.kind].label }
      : null,
    state: 'none',
    ready: false,
    port: null,
    logs: '',
  };
  if (!backend || !base.enabled) return base;

  const name = containerName(projectId, artifactSlug);
  const state = await inspect(name);
  if (state === 'none') return base;

  const runtime = BACKEND_RUNTIMES[backend.kind];
  const logResult = await docker(['logs', '--tail', '80', name]);
  base.logs = (logResult.stdout + logResult.stderr).slice(-6000);

  if (state === 'stopped') return { ...base, state };

  const port = await getBackendHostPort(projectId, artifactSlug, runtime.port);
  const ready = port ? await isReachable(port) : false;
  return { ...base, state: ready ? 'running' : 'starting', port, ready };
}

export async function stopBackend(projectId: string, artifactSlug: string) {
  const name = containerName(projectId, artifactSlug);
  await docker(['rm', '-f', name]);
  await rm(workDir(name), { recursive: true, force: true }).catch(() => {});
  await rm(`${workDir(name)}.env`, { force: true }).catch(() => {});
}

/**
 * Copies the workspace to a scratch dir and returns the hardened `docker run`
 * flags shared by preview and test containers: non-root user (the server's own
 * uid, or 1000 when it runs as root), read-only root fs, tmpfs scratch space,
 * dropped capabilities and CPU/memory/pid limits.
 */
async function prepareSandbox(
  projectId: string,
  artifactSlug: string,
  runtime: BackendRuntime,
  dir: string,
) {
  await mkdir(dir, { recursive: true });
  await cp(artifactWorkspaceDir(projectId, artifactSlug), dir, {
    recursive: true,
  });

  const hostUid = process.getuid?.() ?? 0;
  const uid = hostUid > 0 ? hostUid : 1000;
  if (hostUid === 0 && process.platform !== 'win32') {
    await chownTree(dir, uid);
  }
  await docker([
    'run',
    '--rm',
    '--user=0',
    '--cap-drop=ALL',
    '--cap-add=CHOWN',
    '-v',
    `aw-m2-${projectId}:/m2`,
    runtime.image,
    'chown',
    `${uid}:${uid}`,
    '/m2',
  ]);

  const owner = `uid=${uid},gid=${uid}`;
  return [
    `--user=${uid}:${uid}`,
    '--read-only',
    `--tmpfs=/tmp:rw,exec,size=256m,${owner}`,
    `--tmpfs=/pydeps:rw,exec,size=512m,${owner}`,
    `--memory=${runtime.memory}`,
    '--cpus=1.5',
    '--pids-limit=512',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '-v',
    `${dir}:/app`,
    '-v',
    `aw-m2-${projectId}:/m2`,
    '-w',
    '/app/backend',
    '-e',
    'HOME=/tmp',
    '-e',
    'MAVEN_CONFIG=/tmp/.m2',
    '-e',
    'PYTHONDONTWRITEBYTECODE=1',
  ];
}

/**
 * Runs the generated backend's own test suite (mvn test / pytest) in a
 * short-lived hardened container with an embedded database and returns the
 * output. Shares the preview's enable flag and concurrency cap.
 */
export async function runBackendTests(
  projectId: string,
  artifactSlug: string,
): Promise<
  | { ok: true; passed: boolean; output: string; timedOut: boolean }
  | { ok: false; error: string }
> {
  if (!isBackendPreviewEnabled()) {
    return {
      ok: false,
      error: 'Backend preview is disabled (set BACKEND_PREVIEW_ENABLED=true).',
    };
  }
  if (process.env.NODE_ENV === 'production' && !process.env.BACKEND_PREVIEW_NETWORK) {
    return {
      ok: false,
      error:
        'Set BACKEND_PREVIEW_NETWORK to an egress-restricted Docker network before enabling backend preview in production.',
    };
  }

  const backend = detectBackend(
    await listWorkspaceRelativePaths(projectId, artifactSlug),
  );
  if (!backend) {
    return { ok: false, error: 'No backend found to test.' };
  }

  const running = await docker([
    'ps',
    '-q',
    '--filter',
    'label=aw.backend-preview=1',
  ]);
  if (running.stdout.split('\n').filter(Boolean).length >= MAX_CONCURRENT) {
    return {
      ok: false,
      error: 'Too many backend jobs are running. Try again in a few minutes.',
    };
  }

  const runtime = BACKEND_RUNTIMES[backend.kind];
  const name = `${containerName(projectId, artifactSlug)}-test`;
  const dir = workDir(name);
  await docker(['rm', '-f', name]);

  try {
    const sandbox = await prepareSandbox(projectId, artifactSlug, runtime, dir);
    const args = [
      'run',
      '--rm',
      `--name=${name}`,
      '--label=aw.backend-preview=1',
      ...sandbox,
      '-e',
      `AW_CMD=${runtime.testCommand}`,
    ];
    if (process.env.BACKEND_PREVIEW_NETWORK) {
      args.push(`--network=${process.env.BACKEND_PREVIEW_NETWORK}`);
    }
    args.push(
      runtime.image,
      'sh',
      '-c',
      `exec timeout ${TEST_TIMEOUT_SECONDS} sh -c "$AW_CMD"`,
    );

    const result = await docker(args);
    const output = (result.stdout + result.stderr).slice(-12000);
    return {
      ok: true,
      passed: result.code === 0,
      timedOut: result.code === 124,
      output,
    };
  } finally {
    await docker(['rm', '-f', name]);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Starts the generated backend in a network-enabled container (Maven/pip need
 * to download dependencies) with CPU/memory/pid limits, dropped capabilities
 * and a hard lifetime cap. Set BACKEND_PREVIEW_NETWORK to a pre-created Docker
 * network whose egress rules block internal addresses (cloud metadata, VPC).
 */
export async function startBackend(
  projectId: string,
  artifactSlug: string,
): Promise<{ ok: true; backend: DetectedBackend } | { ok: false; error: string }> {
  if (!isBackendPreviewEnabled()) {
    return {
      ok: false,
      error: 'Backend preview is disabled (set BACKEND_PREVIEW_ENABLED=true).',
    };
  }

  const backend = detectBackend(
    await listWorkspaceRelativePaths(projectId, artifactSlug),
  );
  if (!backend) {
    return {
      ok: false,
      error:
        'No backend found. Expected backend/pom.xml (Spring Boot) or backend/requirements.txt with app/main.py (FastAPI).',
    };
  }
  if (process.env.NODE_ENV === 'production' && !process.env.BACKEND_PREVIEW_NETWORK) {
    return {
      ok: false,
      error:
        'Set BACKEND_PREVIEW_NETWORK to an egress-restricted Docker network before enabling backend preview in production.',
    };
  }

  const name = containerName(projectId, artifactSlug);
  await stopBackend(projectId, artifactSlug);

  const running = await docker([
    'ps',
    '-q',
    '--filter',
    'label=aw.backend-preview=1',
  ]);
  if (running.stdout.split('\n').filter(Boolean).length >= MAX_CONCURRENT) {
    return {
      ok: false,
      error: 'Too many backend previews are running. Try again in a few minutes.',
    };
  }

  const runtime = BACKEND_RUNTIMES[backend.kind];
  const dir = workDir(name);
  const sandbox = await prepareSandbox(projectId, artifactSlug, runtime, dir);

  const args = [
    'run',
    '-d',
    `--name=${name}`,
    '--label=aw.backend-preview=1',
    ...sandbox,
    '-p',
    `127.0.0.1::${runtime.port}`,
    '-e',
    `AW_CMD=${runtime.command(backend)}`,
  ];

  // Managed Postgres (development database). Credentials go through a
  // short-lived env file kept outside the mounted workspace; if provisioning
  // fails the generated app falls back to its embedded database.
  const envFile = `${dir}.env`;
  let hasEnvFile = false;
  if (isManagedDatabaseConfigured()) {
    try {
      const url = await provisionProjectDatabase(projectId, 'DEVELOPMENT');
      const lines = Object.entries(connectionEnvFromUrl(url)).map(
        ([key, value]) => `${key}=${value}`,
      );
      await writeFile(envFile, `${lines.join('\n')}\n`, { mode: 0o600 });
      args.push('--env-file', envFile);
      hasEnvFile = true;
    } catch (error) {
      console.error('[backend-preview] database provisioning failed:', error);
    }
  }
  if (process.env.BACKEND_PREVIEW_NETWORK) {
    args.push(`--network=${process.env.BACKEND_PREVIEW_NETWORK}`);
  }
  args.push(
    runtime.image,
    'sh',
    '-c',
    `exec timeout ${MAX_LIFETIME_SECONDS} sh -c "$AW_CMD"`,
  );

  const result = await docker(args);
  if (hasEnvFile) await rm(envFile, { force: true }).catch(() => {});
  if (result.code !== 0) {
    return {
      ok: false,
      error: `Failed to start Docker container: ${result.stderr.trim().slice(0, 300)}`,
    };
  }

  return { ok: true, backend };
}
