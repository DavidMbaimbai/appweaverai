/**
 * Lightweight, in-memory "who's here right now" presence tracker for the
 * project editor. Deliberately NOT persisted to the database — presence is
 * ephemeral by nature (a browser tab open right now), and adding a DB table
 * plus polling writes for something that expires in seconds would be pure
 * overhead. Each editor tab sends a heartbeat every few seconds; entries
 * older than PRESENCE_TTL_MS are treated as gone.
 *
 * Caveat: this is per-process state, so it won't reflect editors connected
 * to a different server instance in a multi-instance deployment. That's an
 * acceptable tradeoff for an MVP presence indicator (it degrades gracefully
 * to "just showing yourself" rather than breaking anything).
 */

export const PRESENCE_TTL_MS = 15_000;

export type PresenceEntry = {
  userId: string;
  name: string;
  image: string | null;
  lastSeen: number;
};

const presenceByProject = new Map<string, Map<string, PresenceEntry>>();

function pruneStale(entries: Map<string, PresenceEntry>) {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  for (const [userId, entry] of entries) {
    if (entry.lastSeen < cutoff) {
      entries.delete(userId);
    }
  }
}

export function recordHeartbeat(
  projectId: string,
  user: { userId: string; name: string; image: string | null },
) {
  let entries = presenceByProject.get(projectId);
  if (!entries) {
    entries = new Map();
    presenceByProject.set(projectId, entries);
  }

  entries.set(user.userId, { ...user, lastSeen: Date.now() });
  pruneStale(entries);

  return listActivePresence(projectId);
}

export function listActivePresence(projectId: string): PresenceEntry[] {
  const entries = presenceByProject.get(projectId);
  if (!entries) return [];

  pruneStale(entries);
  if (entries.size === 0) {
    presenceByProject.delete(projectId);
    return [];
  }

  return Array.from(entries.values()).sort((a, b) => a.lastSeen - b.lastSeen);
}

export function removePresence(projectId: string, userId: string) {
  const entries = presenceByProject.get(projectId);
  if (!entries) return;

  entries.delete(userId);
  if (entries.size === 0) {
    presenceByProject.delete(projectId);
  }
}
