export type SchedStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED' | 'CANCELLED';

export type SchedTask = { key: string; dependsOn: string[]; status: SchedStatus };

/** Pending tasks whose dependencies are all DONE, in plan order, limited to the free concurrency slots. */
export function pickReady(tasks: SchedTask[], concurrency: number): string[] {
  const done = new Set(tasks.filter((t) => t.status === 'DONE').map((t) => t.key));
  const running = tasks.filter((t) => t.status === 'RUNNING').length;
  const free = Math.max(0, concurrency - running);
  return tasks
    .filter((t) => t.status === 'PENDING' && t.dependsOn.every((d) => done.has(d)))
    .slice(0, free)
    .map((t) => t.key);
}

/** Pending tasks that can never run because a dependency failed, was skipped or was cancelled (transitively). */
export function blockedTasks(tasks: SchedTask[]): string[] {
  const dead = new Set(tasks.filter((t) => t.status === 'FAILED' || t.status === 'SKIPPED' || t.status === 'CANCELLED').map((t) => t.key));
  const blocked: string[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (task.status !== 'PENDING' || dead.has(task.key)) continue;
      if (task.dependsOn.some((d) => dead.has(d))) {
        dead.add(task.key);
        blocked.push(task.key);
        changed = true;
      }
    }
  }
  return blocked;
}

export class TaskTimeoutError extends Error {
  constructor(ms: number) {
    super(`The task did not finish within ${Math.round(ms / 1000)}s.`);
    this.name = 'TaskTimeoutError';
  }
}

/** Rejects after `ms` and aborts `signal` so the underlying call can stop. */
export async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TaskTimeoutError(ms));
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type ScheduleHooks = {
  /** Runs one task. Must resolve to its final status; a throw counts as FAILED. */
  execute: (key: string) => Promise<'DONE' | 'FAILED'>;
  /** Called whenever a task changes status (persist it here). */
  onStatus?: (key: string, status: SchedStatus, reason?: string) => Promise<void> | void;
  /** Checked before every start: false stops the run (kill switch, cancel, credit cap). */
  canContinue?: () => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Epoch ms after which no new task starts. */
  deadline: number;
  concurrency: number;
  now?: () => number;
};

export type ScheduleResult = { statuses: Record<string, SchedStatus>; startOrder: string[]; stoppedReason: string | null };

/**
 * Dependency-respecting scheduler: starts every ready task up to the concurrency limit, never before its
 * dependencies are DONE, propagates failures as SKIPPED, and cancels what is left when the budget, deadline,
 * cancel or kill switch says stop. Pure apart from the hooks, so it is fully testable without a database.
 */
export async function runSchedule(initial: SchedTask[], hooks: ScheduleHooks): Promise<ScheduleResult> {
  const tasks = initial.map((t) => ({ ...t }));
  const now = hooks.now ?? Date.now;
  const startOrder: string[] = [];
  const inFlight = new Map<string, Promise<void>>();
  let stoppedReason: string | null = null;

  const setStatus = async (task: SchedTask, status: SchedStatus, reason?: string) => {
    task.status = status;
    await hooks.onStatus?.(task.key, status, reason);
  };

  const launch = (task: SchedTask) => {
    startOrder.push(task.key);
    const promise = (async () => {
      await setStatus(task, 'RUNNING');
      let result: 'DONE' | 'FAILED' = 'FAILED';
      try {
        result = await hooks.execute(task.key);
      } catch {
        result = 'FAILED';
      }
      await setStatus(task, result);
    })().finally(() => {
      inFlight.delete(task.key);
    });
    inFlight.set(task.key, promise);
  };

  for (;;) {
    for (const key of blockedTasks(tasks)) {
      const task = tasks.find((t) => t.key === key) as SchedTask;
      await setStatus(task, 'SKIPPED', 'A task it depends on did not finish.');
    }

    if (!stoppedReason) {
      if (now() >= hooks.deadline) stoppedReason = 'The run time limit was reached.';
      else {
        const gate = hooks.canContinue ? await hooks.canContinue() : { ok: true as const };
        if (!gate.ok) stoppedReason = gate.reason;
      }
    }

    if (stoppedReason) {
      for (const task of tasks.filter((t) => t.status === 'PENDING')) await setStatus(task, 'CANCELLED', stoppedReason);
    } else {
      for (const key of pickReady(tasks, hooks.concurrency)) launch(tasks.find((t) => t.key === key) as SchedTask);
    }

    if (inFlight.size === 0) {
      if (tasks.some((t) => t.status === 'PENDING') && !stoppedReason) {
        // Nothing runnable and nothing running: the remaining tasks are unreachable.
        for (const task of tasks.filter((t) => t.status === 'PENDING')) await setStatus(task, 'SKIPPED', 'Unreachable task.');
      }
      break;
    }
    await Promise.race(inFlight.values());
  }

  return { statuses: Object.fromEntries(tasks.map((t) => [t.key, t.status])), startOrder, stoppedReason };
}
