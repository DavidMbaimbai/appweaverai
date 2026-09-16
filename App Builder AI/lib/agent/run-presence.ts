/**
 * In-memory "who is currently generating" tracker for a project's agent
 * conversation — the missing piece for real collaboration in this app:
 * since there's no free-text collaborative editor (files are only changed
 * via the AI agent), the meaningful "someone else is editing" signal is
 * "someone else just submitted a prompt and the agent is running".
 *
 * Not persisted to the database — this is transient, per-process state,
 * same tradeoff as lib/presence.ts. A stale entry (e.g. the server crashed
 * mid-run) self-heals after RUN_LOCK_TTL_MS.
 */

const RUN_LOCK_TTL_MS = 3 * 60_000;

type ActiveRun = {
  userId: string;
  name: string;
  startedAt: number;
};

const activeRunByProject = new Map<string, ActiveRun>();

export function startAgentRun(
  projectId: string,
  user: { userId: string; name: string },
) {
  activeRunByProject.set(projectId, { ...user, startedAt: Date.now() });
}

export function endAgentRun(projectId: string, userId: string) {
  const run = activeRunByProject.get(projectId);
  if (run && run.userId === userId) {
    activeRunByProject.delete(projectId);
  }
}

export function getActiveAgentRun(projectId: string): ActiveRun | null {
  const run = activeRunByProject.get(projectId);
  if (!run) return null;

  if (Date.now() - run.startedAt > RUN_LOCK_TTL_MS) {
    activeRunByProject.delete(projectId);
    return null;
  }

  return run;
}
