import { createHash } from 'node:crypto';

export type ChangeOp = 'CREATE' | 'MODIFY' | 'DELETE';

export type Proposal = {
  id: string;
  taskKey?: string;
  role?: string;
  path: string;
  op: ChangeOp;
  /** sha256 of the file when the role read it; null for CREATE. */
  baseHash: string | null;
  baseContent: string | null;
  proposedContent: string | null;
};

export type MergeStatus = 'CLEAN' | 'MERGED' | 'CONFLICT';

export type MergeResult = {
  path: string;
  status: MergeStatus;
  op: ChangeOp;
  baseHash: string | null;
  baseContent: string | null;
  /** null for DELETE, and for CONFLICT (nothing is guessed). */
  finalContent: string | null;
  proposalIds: string[];
  conflict: { reason: string; details: string[] } | null;
};

export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

const lineEnding = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');
const toLines = (text: string) => (text === '' ? [] : text.replace(/\r\n/g, '\n').split('\n'));

export type Hunk = { start: number; end: number; lines: string[] };

const MAX_LCS_CELLS = 4_000_000;

/** Line diff base -> next as replacement hunks over base line ranges [start, end). */
export function diffHunks(base: string[], next: string[]): Hunk[] {
  let prefix = 0;
  while (prefix < base.length && prefix < next.length && base[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < base.length - prefix && suffix < next.length - prefix && base[base.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix += 1;
  const a = base.slice(prefix, base.length - suffix);
  const b = next.slice(prefix, next.length - suffix);
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_LCS_CELLS) {
    return [{ start: prefix, end: prefix + a.length, lines: b }];
  }

  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let current: Hunk | null = null;
  const flush = () => {
    if (current) hunks.push(current);
    current = null;
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      i += 1;
      j += 1;
    } else if (j < b.length && (i === a.length || table[i * width + j + 1] >= table[(i + 1) * width + j])) {
      current ??= { start: prefix + i, end: prefix + i, lines: [] };
      current.lines.push(b[j]);
      j += 1;
    } else {
      current ??= { start: prefix + i, end: prefix + i, lines: [] };
      current.end = prefix + i + 1;
      i += 1;
    }
  }
  flush();
  return hunks;
}

const sameHunk = (x: Hunk, y: Hunk) => x.start === y.start && x.end === y.end && x.lines.length === y.lines.length && x.lines.every((l, n) => l === y.lines[n]);

/** Touching or overlapping ranges are treated as a conflict: they cannot be ordered deterministically. */
const overlaps = (x: Hunk, y: Hunk) => x.start <= y.end && y.start <= x.end;

function applyHunks(base: string[], hunks: Hunk[]): string[] {
  const out: string[] = [];
  let cursor = 0;
  for (const hunk of [...hunks].sort((p, q) => p.start - q.start || p.end - q.end)) {
    out.push(...base.slice(cursor, hunk.start), ...hunk.lines);
    cursor = hunk.end;
  }
  out.push(...base.slice(cursor));
  return out;
}

const conflict = (
  proposals: Proposal[],
  reason: string,
  details: string[],
  op: ChangeOp,
): MergeResult => ({
  path: proposals[0].path,
  status: 'CONFLICT',
  op,
  baseHash: proposals[0].baseHash,
  baseContent: proposals[0].baseContent,
  finalContent: null,
  proposalIds: proposals.map((p) => p.id),
  conflict: { reason, details },
});

const who = (p: Proposal) => `${p.role ?? 'role'}${p.taskKey ? ` (${p.taskKey})` : ''}`;

/**
 * Merges every proposal for ONE file. Deterministic: identical proposals collapse, edits to disjoint line
 * ranges of the same base merge, everything else is reported as a CONFLICT. Nothing is ever overwritten silently.
 */
export function mergeFileProposals(proposals: Proposal[]): MergeResult {
  if (proposals.length === 0) throw new Error('mergeFileProposals needs at least one proposal.');
  const first = proposals[0];
  const ids = proposals.map((p) => p.id);

  const unique = proposals.filter(
    (p, index) => proposals.findIndex((q) => q.op === p.op && q.baseHash === p.baseHash && q.proposedContent === p.proposedContent) === index,
  );
  if (unique.length === 1) {
    const only = unique[0];
    return {
      path: only.path,
      status: proposals.length === 1 ? 'CLEAN' : 'MERGED',
      op: only.op,
      baseHash: only.baseHash,
      baseContent: only.baseContent,
      finalContent: only.op === 'DELETE' ? null : only.proposedContent,
      proposalIds: ids,
      conflict: null,
    };
  }

  const ops = new Set(unique.map((p) => p.op));
  if (ops.has('DELETE')) {
    return conflict(unique, 'One role deletes the file while another changes it.', unique.map((p) => `${who(p)}: ${p.op}`), 'MODIFY');
  }
  if (ops.has('CREATE')) {
    const details = unique.map((p) => `${who(p)}: ${p.op}`);
    return conflict(
      unique,
      ops.has('MODIFY') ? 'One role creates the file while another modifies it.' : 'Several roles create this file with different content.',
      details,
      'CREATE',
    );
  }

  // All MODIFY.
  const hashes = new Set(unique.map((p) => p.baseHash));
  if (hashes.size > 1) {
    return conflict(unique, 'The proposals were written against different versions of the file.', unique.map((p) => `${who(p)}: base ${p.baseHash?.slice(0, 8) ?? 'none'}`), 'MODIFY');
  }
  const baseContent = first.baseContent;
  if (baseContent === null || unique.some((p) => p.proposedContent === null)) {
    return conflict(unique, 'The original file content is not available to merge against.', [], 'MODIFY');
  }

  const eol = lineEnding(baseContent);
  const baseLines = toLines(baseContent);
  const perProposal = unique.map((p) => ({ proposal: p, hunks: diffHunks(baseLines, toLines(p.proposedContent as string)) }));

  const details: string[] = [];
  for (let a = 0; a < perProposal.length; a++) {
    for (let b = a + 1; b < perProposal.length; b++) {
      for (const hx of perProposal[a].hunks) {
        for (const hy of perProposal[b].hunks) {
          if (!sameHunk(hx, hy) && overlaps(hx, hy)) {
            details.push(`${who(perProposal[a].proposal)} and ${who(perProposal[b].proposal)} both change lines ${Math.min(hx.start, hy.start) + 1}-${Math.max(hx.end, hy.end, Math.min(hx.start, hy.start) + 1)}.`);
          }
        }
      }
    }
  }
  if (details.length > 0) return conflict(unique, 'Two roles edited overlapping lines.', details.slice(0, 10), 'MODIFY');

  const hunks: Hunk[] = [];
  for (const { hunks: list } of perProposal) for (const h of list) if (!hunks.some((existing) => sameHunk(existing, h))) hunks.push(h);
  const merged = applyHunks(baseLines, hunks).join(eol);
  return {
    path: first.path,
    status: 'MERGED',
    op: 'MODIFY',
    baseHash: first.baseHash,
    baseContent,
    finalContent: baseContent.endsWith('\n') && !merged.endsWith('\n') ? `${merged}${eol}` : merged,
    proposalIds: ids,
    conflict: null,
  };
}

/** Groups proposals by path and merges each file. Order of results follows first appearance. */
export function mergeProposals(proposals: Proposal[]): MergeResult[] {
  const groups = new Map<string, Proposal[]>();
  for (const p of proposals) groups.set(p.path, [...(groups.get(p.path) ?? []), p]);
  return [...groups.values()].map(mergeFileProposals);
}

/** True when the file on disk no longer matches what the roles read (somebody edited it in the meantime). */
export function isStale(merged: Pick<MergeResult, 'baseHash' | 'op'>, currentContent: string | null): boolean {
  if (merged.op === 'CREATE') return currentContent !== null;
  if (currentContent === null) return true;
  return merged.baseHash !== contentHash(currentContent);
}

export type DiffRow = { type: 'add' | 'del' | 'ctx' | 'gap'; text: string };

/** Compact unified-style rows for the UI: changed lines with `context` lines around them. */
export function lineDiff(base: string | null, next: string | null, context = 3, maxRows = 400): DiffRow[] {
  const a = toLines(base ?? '');
  const b = toLines(next ?? '');
  const hunks = diffHunks(a, b);
  const rows: DiffRow[] = [];
  let cursor = 0;
  for (const hunk of hunks) {
    const ctxStart = Math.max(cursor, hunk.start - context);
    if (ctxStart > cursor && rows.length > 0) rows.push({ type: 'gap', text: '…' });
    for (let i = ctxStart; i < hunk.start; i++) rows.push({ type: 'ctx', text: a[i] });
    for (let i = hunk.start; i < hunk.end; i++) rows.push({ type: 'del', text: a[i] });
    for (const line of hunk.lines) rows.push({ type: 'add', text: line });
    cursor = hunk.end;
    const after = Math.min(a.length, cursor + context);
    // Trailing context is emitted lazily by the next iteration or below.
    for (let i = cursor; i < after && (hunks[hunks.indexOf(hunk) + 1]?.start ?? Infinity) > i; i++) rows.push({ type: 'ctx', text: a[i] });
    cursor = Math.max(cursor, after);
    if (rows.length > maxRows) return [...rows.slice(0, maxRows), { type: 'gap', text: 'Diff truncated' }];
  }
  return rows;
}
