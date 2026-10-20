export type NativePlatform = 'ANDROID' | 'IOS';
export type BuildStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED';

export type RunnerConfig = { url: string; token: string; platforms: ReadonlySet<NativePlatform> };

/**
 * A native build runner is an operator-provided service (e.g. a Linux box with the Android SDK, or a macOS
 * machine with Xcode for iOS). Nothing here builds binaries itself; without these variables every native
 * build is recorded as BLOCKED.
 */
export function getRunnerConfig(env: Record<string, string | undefined> = process.env): RunnerConfig | null {
  const url = env.MOBILE_BUILD_RUNNER_URL?.trim();
  const token = env.MOBILE_BUILD_RUNNER_TOKEN?.trim();
  if (!url || !token) return null;
  try {
    const parsed = new URL(url);
    const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !local) return null;
  } catch {
    return null;
  }
  const platforms = new Set<NativePlatform>();
  for (const entry of (env.MOBILE_BUILD_RUNNER_PLATFORMS ?? 'android').toLowerCase().split(',')) {
    if (entry.trim() === 'android') platforms.add('ANDROID');
    if (entry.trim() === 'ios') platforms.add('IOS');
  }
  return platforms.size > 0 ? { url, token, platforms } : null;
}

export type NativeDecision = { action: 'submit' } | { action: 'blocked'; reason: string };

export function decideNativeBuild(input: {
  platform: NativePlatform;
  runner: RunnerConfig | null;
  hasStoreCredential: boolean;
  /** Placeholder entitlement: native builds are paid-plan only until pricing is decided. */
  planAllowsNative: boolean;
}): NativeDecision {
  if (!input.planAllowsNative) {
    return { action: 'blocked', reason: 'Native builds are not included in your plan. Upgrade, or export the Capacitor project and build it yourself.' };
  }
  if (!input.runner) {
    return {
      action: 'blocked',
      reason:
        'Blocked: external setup. No native build runner is configured (MOBILE_BUILD_RUNNER_URL / MOBILE_BUILD_RUNNER_TOKEN). Download the Capacitor project bundle and build it locally or on your own CI.',
    };
  }
  if (!input.runner.platforms.has(input.platform)) {
    return {
      action: 'blocked',
      reason:
        input.platform === 'IOS'
          ? 'Blocked: external setup. The configured runner does not support iOS; iOS builds need a macOS runner with Xcode and an Apple Developer account.'
          : 'Blocked: external setup. The configured runner does not support Android.',
    };
  }
  if (!input.hasStoreCredential) {
    return {
      action: 'blocked',
      reason: `Blocked: needs credentials. Save your ${input.platform === 'ANDROID' ? 'Google Play service account' : 'App Store Connect API key'} first so the runner can sign and upload.`,
    };
  }
  return { action: 'submit' };
}

const TERMINAL: ReadonlySet<BuildStatus> = new Set(['SUCCEEDED', 'FAILED', 'BLOCKED']);
const ALLOWED: Record<BuildStatus, readonly BuildStatus[]> = {
  QUEUED: ['RUNNING', 'SUCCEEDED', 'FAILED'],
  RUNNING: ['SUCCEEDED', 'FAILED'],
  SUCCEEDED: [],
  FAILED: [],
  BLOCKED: [],
};

export const isTerminalStatus = (status: BuildStatus) => TERMINAL.has(status);
export const canTransition = (from: BuildStatus, to: BuildStatus) => ALLOWED[from].includes(to);

export type RunnerCallback = {
  buildId: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  logs?: string;
  artifactName?: string;
  artifactSha256?: string;
  error?: string;
};

/** A success must name its artifact; a runner can never mark a build SUCCEEDED without one. */
export function parseRunnerCallback(body: unknown): RunnerCallback | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid body.' };
  const b = body as Record<string, unknown>;
  if (typeof b.buildId !== 'string' || !b.buildId) return { error: 'buildId is required.' };
  if (b.status !== 'RUNNING' && b.status !== 'SUCCEEDED' && b.status !== 'FAILED') return { error: 'status must be RUNNING, SUCCEEDED or FAILED.' };
  const str = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : undefined);
  const result: RunnerCallback = {
    buildId: b.buildId,
    status: b.status,
    logs: str(b.logs, 20_000),
    artifactName: str(b.artifactName, 500),
    artifactSha256: str(b.artifactSha256, 64),
    error: str(b.error, 2_000),
  };
  if (result.status === 'SUCCEEDED' && (!result.artifactName || !/^[0-9a-f]{64}$/i.test(result.artifactSha256 ?? ''))) {
    return { error: 'A SUCCEEDED callback must include artifactName and a 64-character artifactSha256.' };
  }
  return result;
}

export type RunnerSubmission = { ok: true; jobId: string } | { ok: false; error: string };

export async function submitToRunner(
  runner: RunnerConfig,
  job: { buildId: string; platform: NativePlatform; appId: string; versionName: string; buildNumber: number; bundleBase64: string; callbackUrl: string },
  fetchImpl: typeof fetch = fetch,
): Promise<RunnerSubmission> {
  try {
    const response = await fetchImpl(`${runner.url.replace(/\/$/, '')}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${runner.token}` },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return { ok: false, error: `Runner rejected the job (HTTP ${response.status}).` };
    const data = (await response.json().catch(() => null)) as { jobId?: unknown } | null;
    if (!data || typeof data.jobId !== 'string' || !data.jobId) return { ok: false, error: 'Runner response did not include a jobId.' };
    return { ok: true, jobId: data.jobId };
  } catch {
    return { ok: false, error: 'Could not reach the build runner.' };
  }
}
