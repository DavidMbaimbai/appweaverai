'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';

import {
  addCommentAction,
  createTaskAction,
  deleteTaskAction,
  loadBoardAction,
  loadCommentsAction,
  moveTaskAction,
  updateTaskAction,
} from '@/lib/team/actions';
import type { BoardTaskView, BoardView } from '@/lib/team/board';
import { SUGGESTED_LABELS } from '@/lib/team/board-logic';
import { can, isTeamRole } from '@/lib/team/permissions';

type Filters = { assigneeId: string; label: string; priority: string; sprint: string; q: string };
const NO_FILTERS: Filters = { assigneeId: '', label: '', priority: '', sprint: '', q: '' };
type Comment = { id: string; body: string; createdAt: string | Date; author?: { name: string | null } | null };

function toFilters(f: Filters) {
  return {
    assigneeId: f.assigneeId || null,
    label: f.label || null,
    priority: f.priority || null,
    sprint: f.sprint || null,
    q: f.q || null,
  };
}

function initials(name: string | null | undefined) {
  return (name ?? '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

export function TaskBoard({ projectId, initial, role }: { projectId: string; initial: BoardView; role: string }) {
  const [board, setBoard] = useState(initial);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ task: BoardTaskView | null; columnId: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const editable = isTeamRole(role) && can(role, 'manage_board');
  const members = useMemo(() => new Map(board.members.map((m) => [m.id, m])), [board.members]);

  const refresh = useCallback(
    async (next: Filters) => {
      const r = await loadBoardAction(projectId, toFilters(next));
      if (r.ok) setBoard(r.board);
      else setError(r.error);
    },
    [projectId],
  );

  function applyFilter(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    startTransition(() => void refresh(next));
  }

  /** Optimistic move; the server's authoritative board replaces local state either way so ordering conflicts self-heal. */
  function move(taskId: string, columnId: string, beforeTaskId: string | null) {
    if (!editable) return;
    const previous = board;
    setBoard((b) => {
      let moving: BoardTaskView | undefined;
      const stripped = b.columns.map((c) => ({ ...c, tasks: c.tasks.filter((t) => (t.id === taskId ? ((moving = t), false) : true)) }));
      if (!moving) return b;
      const task = { ...moving, columnId };
      return {
        ...b,
        columns: stripped.map((c) => {
          if (c.id !== columnId) return c;
          const idx = beforeTaskId ? c.tasks.findIndex((t) => t.id === beforeTaskId) : -1;
          const tasks = [...c.tasks];
          tasks.splice(idx < 0 ? tasks.length : idx, 0, task);
          return { ...c, tasks };
        }),
      };
    });
    setError(null);
    startTransition(async () => {
      const r = await moveTaskAction(projectId, taskId, columnId, beforeTaskId, toFilters(filters));
      if ('board' in r && r.board) setBoard(r.board);
      else setBoard(previous);
      if (!r.ok) setError(r.error);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm" role="search" aria-label="Board filters">
        <input
          aria-label="Search tasks"
          placeholder="Search…"
          className="rounded border border-app-border bg-app-surface px-2 py-1"
          value={filters.q}
          onChange={(e) => applyFilter({ q: e.target.value })}
        />
        <select aria-label="Assignee" className="rounded border border-app-border bg-app-surface px-2 py-1" value={filters.assigneeId} onChange={(e) => applyFilter({ assigneeId: e.target.value })}>
          <option value="">Anyone</option>
          {board.members.map((m) => (
            <option key={m.id} value={m.id}>{m.name ?? m.email}</option>
          ))}
        </select>
        <select aria-label="Label" className="rounded border border-app-border bg-app-surface px-2 py-1" value={filters.label} onChange={(e) => applyFilter({ label: e.target.value })}>
          <option value="">Any label</option>
          {SUGGESTED_LABELS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <select aria-label="Priority" className="rounded border border-app-border bg-app-surface px-2 py-1" value={filters.priority} onChange={(e) => applyFilter({ priority: e.target.value })}>
          <option value="">Any priority</option>
          {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <input aria-label="Sprint" placeholder="Sprint" className="w-28 rounded border border-app-border bg-app-surface px-2 py-1" value={filters.sprint} onChange={(e) => applyFilter({ sprint: e.target.value })} />
        {pending ? <span className="text-app-text-muted" aria-live="polite">Syncing…</span> : null}
      </div>
      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {board.columns.map((col) => (
          <section
            key={col.id}
            aria-label={col.name}
            className="rounded-lg border border-app-border bg-app-surface/50 p-2"
            onDragOver={(e) => editable && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId) move(dragId, col.id, null);
              setDragId(null);
            }}
          >
            <header className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold text-app-text">{col.name} <span className="text-app-text-muted">({col.tasks.length})</span></h2>
              {editable ? (
                <button type="button" className="text-xs text-app-accent" onClick={() => setEditing({ task: null, columnId: col.id })}>+ Add</button>
              ) : null}
            </header>
            <ul className="space-y-2">
              {col.tasks.map((t) => {
                const assignee = t.assigneeId ? members.get(t.assigneeId) : null;
                return (
                  <li
                    key={t.id}
                    draggable={editable}
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => setDragId(null)}
                    onDragOver={(e) => editable && e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (dragId && dragId !== t.id) move(dragId, col.id, t.id);
                      setDragId(null);
                    }}
                    className="rounded-md border border-app-border bg-app-bg p-2 text-sm shadow-sm"
                  >
                    <button type="button" className="block w-full text-left font-medium text-app-text" onClick={() => setEditing({ task: t, columnId: col.id })}>
                      {t.title}
                    </button>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {t.labels.map((l) => (
                        <span key={l} className="rounded bg-app-accent/15 px-1.5 text-xs text-app-text">{l}</span>
                      ))}
                      {t.sprint ? <span className="rounded border border-app-border px-1.5 text-xs">{t.sprint}</span> : null}
                      {t.pendingApprovals ? <span className="rounded bg-amber-500/20 px-1.5 text-xs">Approval pending</span> : null}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-app-text-muted">
                      <span title={assignee?.name ?? 'Unassigned'} className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-app-border text-[10px]">
                        {assignee ? initials(assignee.name ?? assignee.email) : '–'}
                      </span>
                      <span>{t.commentCount} comment{t.commentCount === 1 ? '' : 's'}</span>
                      {editable ? (
                        <label className="sr-only" htmlFor={`move-${t.id}`}>Move {t.title}</label>
                      ) : null}
                      {editable ? (
                        <select
                          id={`move-${t.id}`}
                          aria-label={`Move ${t.title} to column`}
                          className="rounded border border-app-border bg-app-surface px-1 py-0.5"
                          value={t.columnId}
                          onChange={(e) => move(t.id, e.target.value, null)}
                        >
                          {board.columns.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {editing ? (
        <TaskDialog
          key={editing.task?.id ?? 'new'}
          projectId={projectId}
          board={board}
          editing={editing}
          editable={editable}
          canComment={isTeamRole(role) && can(role, 'comment')}
          onClose={() => setEditing(null)}
          onChanged={() => refresh(filters)}
        />
      ) : null}
    </div>
  );
}

function TaskDialog({
  projectId,
  board,
  editing,
  editable,
  canComment,
  onClose,
  onChanged,
}: {
  projectId: string;
  board: BoardView;
  editing: { task: BoardTaskView | null; columnId: string };
  editable: boolean;
  canComment: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const task = editing.task;
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [labels, setLabels] = useState<string[]>(task?.labels ?? []);
  const [priority, setPriority] = useState(task?.priority ?? 'MEDIUM');
  const [sprint, setSprint] = useState(task?.sprint ?? '');
  const [dueDate, setDueDate] = useState(task?.dueDate?.slice(0, 10) ?? '');
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState('');

  const loadComments = useCallback(async () => {
    if (task) setComments((await loadCommentsAction(projectId, task.id)) as unknown as Comment[]);
  }, [projectId, task]);
  if (task && comments === null) void loadComments();

  async function save() {
    const payload = {
      title,
      description: description || null,
      labels,
      priority,
      sprint: sprint || null,
      dueDate: dueDate || null,
      assigneeId: assigneeId || null,
    };
    const r = task
      ? await updateTaskAction(projectId, task.id, task.version, payload)
      : await createTaskAction(projectId, editing.columnId, payload);
    if (!r.ok) {
      setMessage('conflict' in r && r.conflict ? 'Someone else changed this task. The board was refreshed; reopen it to continue.' : r.error);
      if ('conflict' in r && r.conflict) await onChanged();
      return;
    }
    await onChanged();
    onClose();
  }

  async function remove() {
    if (!task) return;
    const r = await deleteTaskAction(projectId, task.id);
    if (!r.ok) return setMessage(r.error);
    await onChanged();
    onClose();
  }

  async function comment() {
    if (!task || !draft.trim()) return;
    const r = await addCommentAction(projectId, task.id, draft);
    if (!r.ok) return setMessage(r.error);
    setDraft('');
    await loadComments();
    await onChanged();
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={task ? 'Edit task' : 'New task'} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-lg border border-app-border bg-app-bg p-4 text-sm">
        <h2 className="text-base font-semibold">{task ? 'Edit task' : `New task in ${board.columns.find((c) => c.id === editing.columnId)?.name}`}</h2>
        <input aria-label="Title" className="w-full rounded border border-app-border bg-app-surface px-2 py-1" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!editable} />
        <textarea aria-label="Description" rows={3} className="w-full rounded border border-app-border bg-app-surface px-2 py-1" value={description} onChange={(e) => setDescription(e.target.value)} disabled={!editable} />
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_LABELS.map((l) => (
            <label key={l} className="flex items-center gap-1">
              <input type="checkbox" disabled={!editable} checked={labels.includes(l)} onChange={(e) => setLabels((cur) => (e.target.checked ? [...cur, l] : cur.filter((x) => x !== l)))} />
              {l}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select aria-label="Assignee" className="rounded border border-app-border bg-app-surface px-2 py-1" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} disabled={!editable}>
            <option value="">Unassigned</option>
            {board.members.map((m) => (
              <option key={m.id} value={m.id}>{m.name ?? m.email}</option>
            ))}
          </select>
          <select aria-label="Priority" className="rounded border border-app-border bg-app-surface px-2 py-1" value={priority} onChange={(e) => setPriority(e.target.value)} disabled={!editable}>
            {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <input aria-label="Sprint" placeholder="Sprint" className="rounded border border-app-border bg-app-surface px-2 py-1" value={sprint} onChange={(e) => setSprint(e.target.value)} disabled={!editable} />
          <input aria-label="Due date" type="date" className="rounded border border-app-border bg-app-surface px-2 py-1" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={!editable} />
        </div>
        {task ? (
          <div className="space-y-2 border-t border-app-border pt-2">
            <h3 className="font-medium">Comments</h3>
            <ul className="space-y-1">
              {(comments ?? []).map((c) => (
                <li key={c.id} className="rounded bg-app-surface p-2">{c.body}</li>
              ))}
            </ul>
            {canComment ? (
              <div className="flex gap-2">
                <input aria-label="Add a comment" placeholder="Write a comment… use @name to mention" className="flex-1 rounded border border-app-border bg-app-surface px-2 py-1" value={draft} onChange={(e) => setDraft(e.target.value)} />
                <button type="button" className="rounded border border-app-border px-2" onClick={comment}>Send</button>
              </div>
            ) : null}
          </div>
        ) : null}
        {message ? <p role="alert" className="text-red-500">{message}</p> : null}
        <div className="flex justify-between">
          {task && editable ? <button type="button" className="text-red-500" onClick={remove}>Delete</button> : <span />}
          <div className="flex gap-2">
            <button type="button" className="rounded border border-app-border px-3 py-1" onClick={onClose}>Close</button>
            {editable ? <button type="button" className="rounded bg-app-accent px-3 py-1 text-white" onClick={save}>Save</button> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
