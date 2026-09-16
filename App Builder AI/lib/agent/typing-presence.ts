/**
 * In-memory "who is currently typing" tracker for a project's agent
 * conversation input box — the "cursor/typing indicator" half of live
 * collaboration for an app where the only shared editing surface is the AI
 * chat input (there's no free-text collaborative document). Each editor
 * sends a heartbeat while its input has content and clears it on submit/
 * empty; stale entries self-heal after TYPING_TTL_MS in case a tab closes
 * without cleanly signaling.
 *
 * Not persisted to the database — same transient, per-process tradeoff as
 * lib/presence.ts and lib/agent/run-presence.ts.
 */

const TYPING_TTL_MS = 6_000;

type TypingEntry = {
  userId: string;
  name: string;
  updatedAt: number;
};

const typingByProject = new Map<string, Map<string, TypingEntry>>();

function pruneStale(entries: Map<string, TypingEntry>) {
  const cutoff = Date.now() - TYPING_TTL_MS;
  for (const [userId, entry] of entries) {
    if (entry.updatedAt < cutoff) {
      entries.delete(userId);
    }
  }
}

export function setTyping(
  projectId: string,
  user: { userId: string; name: string },
  isTyping: boolean,
) {
  let entries = typingByProject.get(projectId);
  if (!entries) {
    entries = new Map();
    typingByProject.set(projectId, entries);
  }

  if (isTyping) {
    entries.set(user.userId, { ...user, updatedAt: Date.now() });
  } else {
    entries.delete(user.userId);
  }
  pruneStale(entries);

  if (entries.size === 0) {
    typingByProject.delete(projectId);
  }
}

export function listTypingUsers(
  projectId: string,
  excludeUserId?: string,
): TypingEntry[] {
  const entries = typingByProject.get(projectId);
  if (!entries) return [];

  pruneStale(entries);
  if (entries.size === 0) {
    typingByProject.delete(projectId);
    return [];
  }

  return Array.from(entries.values()).filter(
    (entry) => entry.userId !== excludeUserId,
  );
}
