import type { MemoryRecord, MemoryType } from './types';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'be', 'with', 'by', 'at', 'as', 'it', 'this', 'that', 'from', 'we', 'use', 'uses', 'using',
]);

export function normaliseTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenise(text: string): string[] {
  return normaliseTitle(text)
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Jaccard similarity of the token sets, 0..1. */
export function similarity(a: string, b: string) {
  const sa = new Set(tokenise(a));
  const sb = new Set(tokenise(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared += 1;
  return shared / (sa.size + sb.size - shared);
}

const TITLE_MATCH = 0.7;
const BODY_DUPLICATE = 0.85;

/** Bug entries describe one lifecycle, so a fix replaces its bug report. */
function sameFamily(a: MemoryType, b: MemoryType) {
  if (a === b) return true;
  return (a === 'KNOWN_BUG' || a === 'FIXED_BUG') && (b === 'KNOWN_BUG' || b === 'FIXED_BUG');
}

export type Candidate = { type: MemoryType; title: string; body: string };

export type Reconciliation =
  | { action: 'create'; supersedeIds: string[] }
  | { action: 'skip'; reason: 'duplicate' | 'protected-by-user' | 'rejected'; existingId: string };

/**
 * Decides how an agent-proposed entry interacts with existing ACTIVE entries.
 * Near-identical entries are dropped; updated or contradicting ones supersede the old entry;
 * pinned or user-authored entries are never overridden by the agent.
 */
export function reconcileCandidate(candidate: Candidate, existing: MemoryRecord[]): Reconciliation {
  const normalised = normaliseTitle(candidate.title);
  const related = existing.filter(
    (e) =>
      e.status === 'ACTIVE' &&
      sameFamily(e.type, candidate.type) &&
      (e.normalizedTitle === normalised || similarity(e.title, candidate.title) >= TITLE_MATCH),
  );
  const rejected = existing.find(
    (e) =>
      e.status === 'REJECTED' &&
      sameFamily(e.type, candidate.type) &&
      (e.normalizedTitle === normalised || similarity(e.title, candidate.title) >= TITLE_MATCH),
  );
  if (rejected) return { action: 'skip', reason: 'rejected', existingId: rejected.id };
  const supersedeIds: string[] = [];
  for (const old of related) {
    const bodySimilarity = similarity(old.body, candidate.body);
    const sameKind = old.type === candidate.type;
    if (sameKind && bodySimilarity >= BODY_DUPLICATE) {
      return { action: 'skip', reason: 'duplicate', existingId: old.id };
    }
    if (old.pinned || old.source === 'USER') {
      return { action: 'skip', reason: 'protected-by-user', existingId: old.id };
    }
    supersedeIds.push(old.id);
  }
  return { action: 'create', supersedeIds };
}
