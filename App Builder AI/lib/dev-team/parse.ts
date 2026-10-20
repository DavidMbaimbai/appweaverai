import { redactSensitive } from '@/lib/agents/untrusted';

import { authoriseProposal, normaliseProposalPath } from './permissions';
import { contentHash } from './merge';
import type { DevTeamLimits, DevTeamRoleName } from './types';

/** Pulls the first balanced JSON object out of model text (tolerates code fences and prose around it). */
export function extractJsonObject(text: string): unknown | null {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Files the role was shown, keyed by normalised path. Only files shown in full and marked editable may be modified. */
export type ProvidedFile = { content: string; hash: string; editable: boolean };
export type ProvidedFiles = Map<string, ProvidedFile>;

export function provideFile(map: ProvidedFiles, path: string, content: string, editable: boolean) {
  map.set(path, { content, hash: contentHash(content), editable });
}

export type ParsedProposal = {
  path: string;
  op: 'CREATE' | 'MODIFY' | 'DELETE';
  baseHash: string | null;
  baseContent: string | null;
  proposedContent: string | null;
  rationale: string;
};

export type ParsedTaskOutput = {
  summary: string;
  messages: string[];
  proposals: ParsedProposal[];
  rejected: Array<{ path: string; reason: string }>;
};

/** Markers the untrusted-content wrapper inserts; a role that copies them into a file would corrupt it. */
const SANITISER_MARKERS = ['[removed instruction-like text]', '[tag removed]', '[redacted-'];

const clean = (value: unknown, max: number) =>
  redactSensitive(typeof value === 'string' ? value.replace(/\u0000/g, '').trim() : '').slice(0, max);

/**
 * Validates a role's reply. Permission scope, path safety, file existence, size and corruption markers are
 * all enforced here, so a model can never smuggle a change past the role's permissions.
 */
export function parseTaskOutput(
  text: string,
  role: DevTeamRoleName,
  provided: ProvidedFiles,
  existing: ReadonlySet<string>,
  limits: Pick<DevTeamLimits, 'maxFilesPerProposal' | 'maxFileBytes'>,
): ParsedTaskOutput | null {
  const raw = extractJsonObject(text);
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const out: ParsedTaskOutput = {
    summary: clean(record.summary, 600),
    messages: (Array.isArray(record.messages) ? record.messages : []).map((m) => clean(m, 400)).filter(Boolean).slice(0, 5),
    proposals: [],
    rejected: [],
  };

  const changes = Array.isArray(record.changes) ? record.changes : [];
  for (const change of changes.slice(0, limits.maxFilesPerProposal + 10)) {
    if (!change || typeof change !== 'object') continue;
    const item = change as Record<string, unknown>;
    const pathCheck = normaliseProposalPath(item.path);
    const label = typeof item.path === 'string' ? item.path.slice(0, 120) : '(invalid)';
    if (!pathCheck.ok) {
      out.rejected.push({ path: label, reason: pathCheck.reason });
      continue;
    }
    const path = pathCheck.path;
    const allowed = authoriseProposal(role, path);
    if (!allowed.allowed) {
      out.rejected.push({ path, reason: allowed.reason });
      continue;
    }
    if (out.proposals.length >= limits.maxFilesPerProposal) {
      out.rejected.push({ path, reason: `Too many files in one task (limit ${limits.maxFilesPerProposal}).` });
      continue;
    }
    if (out.proposals.some((p) => p.path === path)) {
      out.rejected.push({ path, reason: 'The same file appears twice in one task.' });
      continue;
    }
    const op = item.op;
    const rationale = clean(item.rationale, 500);
    if (op !== 'CREATE' && op !== 'MODIFY' && op !== 'DELETE') {
      out.rejected.push({ path, reason: 'Unknown operation.' });
      continue;
    }

    if (op === 'CREATE') {
      if (existing.has(path)) {
        out.rejected.push({ path, reason: 'The file already exists; use MODIFY.' });
        continue;
      }
    } else {
      const base = provided.get(path);
      if (!base || !existing.has(path)) {
        out.rejected.push({ path, reason: 'The file was not shown to this role, so it cannot be changed.' });
        continue;
      }
      if (!base.editable) {
        out.rejected.push({ path, reason: 'The file was only shown as a read-only reference.' });
        continue;
      }
    }

    let content: string | null = null;
    if (op !== 'DELETE') {
      if (typeof item.content !== 'string') {
        out.rejected.push({ path, reason: 'Missing file content.' });
        continue;
      }
      content = item.content.replace(/\u0000/g, '');
      if (Buffer.byteLength(content) > limits.maxFileBytes) {
        out.rejected.push({ path, reason: 'The proposed file is too large.' });
        continue;
      }
      const baseText = provided.get(path)?.content ?? '';
      if (SANITISER_MARKERS.some((marker) => content!.includes(marker) && !baseText.includes(marker))) {
        out.rejected.push({ path, reason: 'The proposed content contains placeholder text from sanitised input; rejected to avoid corrupting the file.' });
        continue;
      }
      if (op === 'MODIFY' && content === baseText) {
        out.rejected.push({ path, reason: 'No change.' });
        continue;
      }
    }

    const base = op === 'CREATE' ? null : (provided.get(path) as ProvidedFile);
    out.proposals.push({
      path,
      op,
      baseHash: base?.hash ?? null,
      baseContent: base?.content ?? null,
      proposedContent: content,
      rationale,
    });
  }
  return out;
}
