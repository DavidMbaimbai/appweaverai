import { describe, expect, it } from 'vitest';

import { buildDevTeamEstimate } from './credits';
import { findCycle, validatePlan } from './dag';
import { contentHash, isStale, mergeFileProposals, mergeProposals, type Proposal } from './merge';
import { parseTaskOutput, provideFile, type ProvidedFiles } from './parse';
import { authoriseAction, authoriseProposal, normaliseProposalPath } from './permissions';
import { runSchedule, type SchedTask } from './scheduler';
import { DEV_TEAM_DEFAULTS } from './types';
import { verifyMerged } from './verify';

const task = (key: string, role: string, dependsOn: string[] = []) => ({ key, role, title: `Task ${key}`, description: 'd', dependsOn, files: [] });

describe('plan validation', () => {
  it('accepts a valid DAG', () => {
    const r = validatePlan([task('t1', 'ARCHITECT'), task('t2', 'BACKEND', ['t1']), task('t3', 'TESTING', ['t2'])]);
    expect(r.ok).toBe(true);
  });
  it('rejects cycles, unknown roles, unknown deps and oversize plans', () => {
    expect(findCycle([{ key: 't1', dependsOn: ['t2'] }, { key: 't2', dependsOn: ['t1'] }]).length).toBeGreaterThan(0);
    expect(validatePlan([task('t1', 'BACKEND', ['t2']), task('t2', 'BACKEND', ['t1'])]).ok).toBe(false);
    expect(validatePlan([task('t1', 'WIZARD')]).ok).toBe(false);
    expect(validatePlan([task('t1', 'BACKEND', ['t9'])]).ok).toBe(false);
    const many = Array.from({ length: DEV_TEAM_DEFAULTS.maxTasks + 1 }, (_, i) => task(`t${i + 1}`, 'BACKEND'));
    expect(validatePlan(many).ok).toBe(false);
    expect(validatePlan([]).ok).toBe(false);
  });
});

describe('scheduler', () => {
  const tasks: SchedTask[] = [
    { key: 't1', dependsOn: [], status: 'PENDING' },
    { key: 't2', dependsOn: ['t1'], status: 'PENDING' },
    { key: 't3', dependsOn: ['t1'], status: 'PENDING' },
    { key: 't4', dependsOn: ['t2', 't3'], status: 'PENDING' },
  ];
  it('respects dependencies and the concurrency limit', async () => {
    let running = 0;
    let peak = 0;
    const finished: string[] = [];
    const result = await runSchedule(tasks, {
      concurrency: 2,
      deadline: Date.now() + 10_000,
      execute: async (key) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        finished.push(key);
        return 'DONE';
      },
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(result.startOrder[0]).toBe('t1');
    expect(result.startOrder[3]).toBe('t4');
    expect(finished.indexOf('t1')).toBeLessThan(finished.indexOf('t2'));
  });
  it('skips dependents of a failed task and stops when told to', async () => {
    const failed = await runSchedule(tasks, { concurrency: 2, deadline: Date.now() + 10_000, execute: async (k) => (k === 't1' ? 'FAILED' : 'DONE') });
    expect(failed.statuses.t2).toBe('SKIPPED');
    expect(failed.statuses.t4).toBe('SKIPPED');
    const stopped = await runSchedule(tasks, { concurrency: 1, deadline: Date.now() + 10_000, canContinue: async () => ({ ok: false, reason: 'paused' }), execute: async () => 'DONE' });
    expect(stopped.stoppedReason).toBe('paused');
    expect(stopped.startOrder).toEqual([]);
  });
});

describe('permissions', () => {
  it('makes architect, testing and security read-only', () => {
    for (const role of ['ARCHITECT', 'TESTING', 'SECURITY'] as const) {
      expect(authoriseProposal(role, 'src/app.ts').allowed).toBe(false);
    }
    expect(authoriseProposal('FRONTEND', 'components/button.tsx').allowed).toBe(true);
  });
  it('never lets a role apply, publish, message or spend', () => {
    for (const role of ['ARCHITECT', 'FRONTEND', 'BACKEND', 'DATABASE', 'TESTING', 'SECURITY', 'DEVOPS'] as const) {
      for (const action of ['apply_change', 'publish', 'send_external_message', 'spend_marketing_credits', 'spend_dev_credits'] as const) {
        expect(authoriseAction(role, action).allowed).toBe(false);
      }
    }
  });
  it('rejects unsafe paths', () => {
    for (const p of ['../x.ts', '/etc/passwd', '.env', '.git/config', 'node_modules/a.js', 'a\u0000b']) {
      expect(normaliseProposalPath(p).ok).toBe(false);
    }
    expect(normaliseProposalPath('lib/a.ts').ok).toBe(true);
  });
});

const base = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n');
const proposal = (id: string, content: string, over: Partial<Proposal> = {}): Proposal => ({
  id,
  path: 'src/x.ts',
  op: 'MODIFY',
  baseHash: contentHash(base),
  baseContent: base,
  proposedContent: content,
  ...over,
});

describe('merge', () => {
  it('merges disjoint edits deterministically', () => {
    const r = mergeFileProposals([proposal('1', base.replace('a', 'A')), proposal('2', base.replace('h', 'H'))]);
    expect(r.status).toBe('MERGED');
    expect(r.finalContent).toBe(['A', 'b', 'c', 'd', 'e', 'f', 'g', 'H'].join('\n'));
  });
  it('flags overlapping edits and never picks one', () => {
    const r = mergeFileProposals([proposal('1', base.replace('c', 'X')), proposal('2', base.replace('c', 'Y'))]);
    expect(r.status).toBe('CONFLICT');
    expect(r.finalContent).toBeNull();
  });
  it('flags differing base hashes, delete vs modify and double create', () => {
    expect(mergeFileProposals([proposal('1', 'x'), proposal('2', 'y', { baseHash: contentHash('other') })]).status).toBe('CONFLICT');
    expect(mergeFileProposals([proposal('1', base.replace('a', 'A')), proposal('2', null as never, { op: 'DELETE', proposedContent: null })]).status).toBe('CONFLICT');
    const create = (id: string, c: string): Proposal => ({ id, path: 'n.ts', op: 'CREATE', baseHash: null, baseContent: null, proposedContent: c });
    expect(mergeFileProposals([create('1', 'a'), create('2', 'b')]).status).toBe('CONFLICT');
  });
  it('preserves CRLF line endings and groups by file', () => {
    const crlf = 'a\r\nb\r\nc\r\nd\r\ne';
    const p = (id: string, c: string): Proposal => ({ id, path: 'f.ts', op: 'MODIFY', baseHash: contentHash(crlf), baseContent: crlf, proposedContent: c });
    const r = mergeFileProposals([p('1', 'A\r\nb\r\nc\r\nd\r\ne'), p('2', 'a\r\nb\r\nc\r\nd\r\nE')]);
    expect(r.finalContent).toBe('A\r\nb\r\nc\r\nd\r\nE');
    expect(mergeProposals([proposal('1', 'z'), proposal('2', 'q', { path: 'other.ts' })])).toHaveLength(2);
  });
  it('detects a file changed since it was read', () => {
    const r = mergeFileProposals([proposal('1', base.replace('a', 'A'))]);
    expect(isStale(r, base)).toBe(false);
    expect(isStale(r, `${base}\nchanged`)).toBe(true);
  });
});

describe('parseTaskOutput', () => {
  const limits = { maxFilesPerProposal: 6, maxFileBytes: 120_000 };
  const files = (): ProvidedFiles => {
    const m: ProvidedFiles = new Map();
    provideFile(m, 'lib/a.ts', 'one', true);
    return m;
  };
  const reply = (changes: unknown[]) => JSON.stringify({ summary: 's', messages: [], changes });
  it('accepts in-scope edits and rejects read-only roles', () => {
    const body = reply([{ path: 'lib/a.ts', op: 'MODIFY', content: 'two', rationale: 'r' }]);
    expect(parseTaskOutput(body, 'BACKEND', files(), new Set(['lib/a.ts']), limits)?.proposals).toHaveLength(1);
    const ro = parseTaskOutput(body, 'SECURITY', files(), new Set(['lib/a.ts']), limits);
    expect(ro?.proposals).toHaveLength(0);
    expect(ro?.rejected).toHaveLength(1);
  });
  it('rejects forbidden paths and sanitiser markers', () => {
    const out = parseTaskOutput(
      reply([
        { path: '.env', op: 'CREATE', content: 'x', rationale: '' },
        { path: 'lib/a.ts', op: 'MODIFY', content: 'ok [removed instruction-like text]', rationale: '' },
      ]),
      'BACKEND',
      files(),
      new Set(['lib/a.ts']),
      limits,
    );
    expect(out?.proposals).toHaveLength(0);
    expect(out?.rejected).toHaveLength(2);
  });
  it('returns null for non-JSON replies', () => {
    expect(parseTaskOutput('no json here', 'BACKEND', files(), new Set(), limits)).toBeNull();
  });
});

describe('verification gating', () => {
  const noop = () => false;
  const file = (finalContent: string) => ({ path: 'src/a.js', op: 'MODIFY' as const, status: 'MERGED' as const, baseContent: 'ok', finalContent });
  it('never reports regression as passed and requires acknowledgement data', async () => {
    const r = await verifyMerged({
      files: [file('safe')],
      protectedFeatures: [],
      matchesProtectedPath: noop,
      baselineRegression: { status: 'PASSED', createdAt: new Date().toISOString() },
      scan: async () => ({ findings: [], filesScanned: 1, dependencySummary: 'none' }) as never,
    });
    expect(r.regression.status).toBe('NOT_RUN');
  });
  it('blocks on unresolved conflicts and on a scan that fails to run', async () => {
    const r = await verifyMerged({
      files: [{ ...file('x'), status: 'CONFLICT' }],
      protectedFeatures: [],
      matchesProtectedPath: noop,
      baselineRegression: null,
      scan: async () => {
        throw new Error('scanner down');
      },
    });
    expect(r.canApprove).toBe(false);
    expect(r.unresolvedFiles).toEqual(['src/a.js']);
  });
  it('shows not run when the scan throws', async () => {
    const r = await verifyMerged({
      files: [file('x')],
      protectedFeatures: [],
      matchesProtectedPath: noop,
      baselineRegression: null,
      scan: async () => {
        throw new Error('scanner down');
      },
    });
    expect(r.scan.status).toBe('NOT_RUN');
    expect(r.canApprove).toBe(false);
  });
});

describe('estimate', () => {
  const limits = { maxTasks: 8, plannerCredits: 3, taskCredits: 4, resolverCredits: 3, runCreditCap: 40 };
  it('caps the run and blocks insufficient balances for metered users', () => {
    const e = buildDevTeamEstimate({ limits, metered: true, balance: 100 });
    expect(e.maxCredits).toBe(Math.min(40, 3 + 8 * 4 + 3));
    expect(e.blocked).toBeNull();
    expect(buildDevTeamEstimate({ limits, metered: true, balance: 1 }).blocked?.reason).toBe('INSUFFICIENT_CREDITS');
    expect(buildDevTeamEstimate({ limits, metered: false, balance: 0 }).blocked).toBeNull();
    expect(buildDevTeamEstimate({ limits: { ...limits, runCreditCap: 10 }, metered: true, balance: 100 }).maxCredits).toBe(10);
  });
});
