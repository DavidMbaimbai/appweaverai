export const POSITION_STEP = 1024;
const MIN_GAP = 1e-6;

export const DEFAULT_COLUMNS = [
  { name: 'Backlog', isDone: false },
  { name: 'In Progress', isDone: false },
  { name: 'Code Review', isDone: false },
  { name: 'Done', isDone: true },
] as const;

export const SUGGESTED_LABELS = ['Design', 'Enhancement', 'Marketing', 'Bug'] as const;
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type TaskPriorityName = (typeof PRIORITIES)[number];

export function positionBetween(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return POSITION_STEP;
  if (prev === null) return (next as number) - POSITION_STEP;
  if (next === null) return prev + POSITION_STEP;
  return (prev + next) / 2;
}

export type OrderedTask = { id: string; position: number };

export type MovePlan = {
  position: number;
  /** Final order of the destination column when positions got too tight and must be renumbered. */
  rebalance: string[] | null;
};

/**
 * Where to put `movingId` in a column. `beforeId` is the card it was dropped above (null = bottom).
 * If that card vanished meanwhile (someone else moved or deleted it) the card goes to the bottom instead of failing.
 */
export function planMove(columnTasks: OrderedTask[], movingId: string, beforeId: string | null): MovePlan {
  const others = columnTasks.filter((t) => t.id !== movingId).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const idx = beforeId ? others.findIndex((t) => t.id === beforeId) : -1;
  const insertAt = idx === -1 ? others.length : idx;
  const prev = insertAt > 0 ? others[insertAt - 1].position : null;
  const next = insertAt < others.length ? others[insertAt].position : null;
  const position = positionBetween(prev, next);
  const tight = prev !== null && next !== null && next - prev < MIN_GAP * 2;
  if (!tight) return { position, rebalance: null };
  const ids = others.map((t) => t.id);
  ids.splice(insertAt, 0, movingId);
  return { position, rebalance: ids };
}

export type TaskInput = {
  title: string;
  description: string | null;
  labels: string[];
  priority: TaskPriorityName;
  dueDate: Date | null;
  sprint: string | null;
};

export type SanitizedTask = { ok: true; value: TaskInput } | { ok: false; error: string };

export function sanitizeTaskInput(raw: {
  title?: unknown;
  description?: unknown;
  labels?: unknown;
  priority?: unknown;
  dueDate?: unknown;
  sprint?: unknown;
}): SanitizedTask {
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) return { ok: false, error: 'A task needs a title.' };
  if (title.length > 160) return { ok: false, error: 'Keep the title under 160 characters.' };

  const description = typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : null;
  if (description && description.length > 10_000) return { ok: false, error: 'The description is too long.' };

  const labelsIn = Array.isArray(raw.labels) ? raw.labels : [];
  const labels = [...new Set(labelsIn.filter((l): l is string => typeof l === 'string').map((l) => l.trim()).filter(Boolean))];
  if (labels.some((l) => l.length > 24) || labels.length > 6) return { ok: false, error: 'Use up to 6 labels of 24 characters.' };

  const priority = (PRIORITIES as readonly string[]).includes(raw.priority as string) ? (raw.priority as TaskPriorityName) : 'MEDIUM';

  let dueDate: Date | null = null;
  if (raw.dueDate) {
    dueDate = new Date(raw.dueDate as string);
    if (Number.isNaN(dueDate.getTime())) return { ok: false, error: 'That due date is not valid.' };
  }
  const sprint = typeof raw.sprint === 'string' && raw.sprint.trim() ? raw.sprint.trim() : null;
  if (sprint && sprint.length > 40) return { ok: false, error: 'Sprint names are limited to 40 characters.' };
  return { ok: true, value: { title, description, labels, priority, dueDate, sprint } };
}

const MENTION = /(^|[^\w@.])@([a-z0-9][a-z0-9._-]{0,38}[a-z0-9]|[a-z0-9])/gi;

/** Lower-case handles written as `@handle` in a comment (deduplicated; email addresses are not mentions). */
export function extractMentionHandles(body: string): string[] {
  const handles = new Set<string>();
  for (const match of body.matchAll(MENTION)) handles.add(match[2].toLowerCase());
  return [...handles];
}

export type MentionCandidate = { id: string; username: string | null; email: string | null };

export function handleFor(candidate: MentionCandidate): string {
  return (candidate.username ?? candidate.email?.split('@')[0] ?? '').toLowerCase();
}

/** Only people who have access to the project can be mentioned; unknown handles are ignored. */
export function resolveMentions(body: string, candidates: MentionCandidate[]): string[] {
  const wanted = new Set(extractMentionHandles(body));
  return candidates.filter((c) => wanted.has(handleFor(c))).map((c) => c.id);
}
