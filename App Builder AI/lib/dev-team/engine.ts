import type { Prisma } from '@/lib/generated/prisma/client';
import { isGloballyPaused } from '@/lib/agents/pause';
import { detectInjection, redactSensitive } from '@/lib/agents/untrusted';
import { getLatestRegression } from '@/lib/code-scan/regression';
import { reportFailure } from '@/lib/monitoring';
import { prisma } from '@/lib/prisma';
import { listProjectFiles, readProjectFile } from '@/lib/project-files';
import { matchesProtectedPath, protectedFeaturesOf } from '@/lib/project-memory/brief';
import { prepareProjectBrief } from '@/lib/project-memory/prepare-run';
import { listActiveMemories } from '@/lib/project-memory/store';

import { resolveLimits } from './dag';
import { selectFilesForTask } from './files';
import { buildPlannerCall, parsePlan, type ParsedPlan } from './planner';
import { defaultDevTeamModel, type DevTeamModelCall } from './model';
import { isStale, mergeProposals, type MergeResult, type Proposal } from './merge';
import { parseTaskOutput, provideFile, type ProvidedFiles } from './parse';
import { buildTaskCall, type DependencyOutput, type FileForPrompt } from './prompts';
import { runSchedule, withTimeout, type SchedStatus } from './scheduler';
import { settleRunCredits } from './credits';
import { transitiveDependencies } from './dag';
import { verifyMerged, type VerificationResult } from './verify';
import { DEV_TEAM_ROLE_LABELS, isDevTeamRole, type DevTeamLimits, type DevTeamRoleName } from './types';

export type EngineDeps = { model?: DevTeamModelCall; limits?: DevTeamLimits };

const GENERIC_FAILURE = 'The AI team could not finish this run. Nothing was changed.';

export async function addMessage(
  runId: string,
  input: { role?: DevTeamRoleName | null; kind?: string; content: string; taskId?: string | null },
) {
  await prisma.devTeamMessage.create({
    data: {
      runId,
      taskId: input.taskId ?? null,
      role: input.role ?? null,
      kind: input.kind ?? 'NOTE',
      content: redactSensitive(input.content).slice(0, 2000),
    },
  });
}

/** Per-run budget: credits and model calls can never exceed the reservation / the call cap. */
class RunBudget {
  constructor(
    private readonly runId: string,
    readonly reserved: number,
    public spent: number,
    private calls: number,
    private readonly maxCalls: number,
  ) {}

  canSpend(amount: number) {
    return this.spent + amount <= this.reserved && this.calls < this.maxCalls;
  }

  async record(amount: number) {
    this.spent += amount;
    this.calls += 1;
    await prisma.devTeamRun.update({ where: { id: this.runId }, data: { spentCredits: this.spent } });
  }
}

async function stopReason(runId: string, projectId: string): Promise<string | null> {
  if (await isGloballyPaused()) return 'The kill switch is on, so the AI team stopped.';
  const run = await prisma.devTeamRun.findFirst({ where: { id: runId, projectId }, select: { status: true } });
  if (!run || run.status === 'CANCELLED') return 'The run was cancelled.';
  return null;
}

async function failRun(runId: string, projectId: string, error: string) {
  const run = await prisma.devTeamRun.findFirst({ where: { id: runId, projectId }, select: { creditKey: true, reservedCredits: true, spentCredits: true, status: true } });
  if (!run) return;
  await prisma.devTeamTask.updateMany({ where: { runId, status: { in: ['PENDING', 'RUNNING'] } }, data: { status: 'CANCELLED', finishedAt: new Date() } });
  await prisma.devTeamRun.updateMany({
    where: { id: runId, projectId, status: { in: ['PLANNING', 'RUNNING'] } },
    data: { status: 'FAILED', error: redactSensitive(error).slice(0, 1000), finishedAt: new Date() },
  });
  await addMessage(runId, { kind: 'SYSTEM', content: `Run failed: ${error}` });
  // Failures refund the whole reservation, like every other credit-metered operation.
  await settleRunCredits({ creditKey: run.creditKey, reserved: run.reservedCredits, spent: run.spentCredits, failed: true }).catch((e) =>
    console.error('[dev-team] refund failed:', e),
  );
}

type Snapshot = { content: string; rel: string };

/** Runs a whole dev-team run: plan, schedule tasks, merge, resolve, verify. Never applies anything. */
export async function executeRun(args: { runId: string; projectId: string; deps?: EngineDeps }): Promise<void> {
  const limits = args.deps?.limits ?? resolveLimits();
  const callModel = args.deps?.model ?? defaultDevTeamModel;
  const run = await prisma.devTeamRun.findFirst({ where: { id: args.runId, projectId: args.projectId, status: 'PLANNING' } });
  if (!run) return;
  const { projectId, id: runId } = run;

  try {
    const blocked = await stopReason(runId, projectId);
    if (blocked) return void (await failRun(runId, projectId, blocked));

    const budget = new RunBudget(runId, run.reservedCredits, run.spentCredits, 0, limits.maxModelCalls);
    const listed = (await listProjectFiles(projectId, run.artifactSlug)).map((f) => ({ path: f.path.slice(run.artifactSlug.length + 1), size: f.sizeBytes }));
    const existing = new Set(listed.map((f) => f.path));
    const prepared = await prepareProjectBrief({ projectId, artifactSlug: run.artifactSlug, request: run.goal });
    const brief = prepared.text;

    // Run-wide snapshot: every task sees the same base, so proposals for one file share a base hash.
    const snapshots = new Map<string, Snapshot | null>();
    const readSnapshot = async (rel: string): Promise<Snapshot | null> => {
      if (snapshots.has(rel)) return snapshots.get(rel) ?? null;
      const content = await readProjectFile(projectId, run.artifactSlug, rel).catch(() => null);
      const snap = typeof content === 'string' ? { content, rel } : null;
      snapshots.set(rel, snap);
      return snap;
    };

    // 1. Architect plans.
    let plan: ParsedPlan = { ok: false, errors: ['No plan.'] };
    for (let attempt = 0; attempt < 2 && !plan.ok; attempt++) {
      if (!budget.canSpend(limits.plannerCredits)) break;
      const call = buildPlannerCall({ goal: run.goal, brief, filePaths: listed.map((f) => f.path), limits });
      const user = !plan.ok && attempt > 0 ? `${call.messages[0].content}\n\nYour previous plan was rejected: ${plan.errors.join(' ')} Return a corrected plan.` : call.messages[0].content;
      try {
        const reply = await withTimeout((signal) => callModel({ system: call.system, user, maxTokens: 2500, signal }), limits.taskTimeoutMs);
        await budget.record(limits.plannerCredits);
        plan = parsePlan(reply.text, limits);
      } catch (error) {
        await budget.record(limits.plannerCredits);
        plan = { ok: false, errors: [error instanceof Error ? error.message : 'Planner failed.'] };
      }
    }
    if (!plan.ok) return void (await failRun(runId, projectId, `The architect could not produce a valid plan: ${plan.errors.join(' ')}`));

    await prisma.devTeamTask.createMany({
      data: plan.tasks.map((t) => ({
        runId,
        key: t.key,
        role: t.role,
        title: t.title,
        description: t.description,
        dependsOn: t.dependsOn,
        input: { files: t.files } as Prisma.InputJsonValue,
      })),
    });
    await prisma.devTeamRun.updateMany({ where: { id: runId, projectId, status: 'PLANNING' }, data: { status: 'RUNNING', startedAt: new Date(), planSummary: plan.summary || null } });
    await addMessage(runId, { role: 'ARCHITECT', kind: 'PLAN', content: plan.summary || `Planned ${plan.tasks.length} task(s).` });

    const taskRows = await prisma.devTeamTask.findMany({ where: { runId } });
    const byKey = new Map(taskRows.map((t) => [t.key, t]));

    // 2. Scheduler runs ready tasks.
    const execute = async (key: string): Promise<'DONE' | 'FAILED'> => {
      const task = byKey.get(key);
      if (!task || !isDevTeamRole(task.role)) return 'FAILED';
      const role = task.role as DevTeamRoleName;

      const doneTasks = await prisma.devTeamTask.findMany({ where: { runId, status: 'DONE' } });
      const upstream = transitiveDependencies(taskRows, key);
      const dependencies: DependencyOutput[] = doneTasks
        .filter((t) => upstream.includes(t.key))
        .map((t) => {
          const out = (t.output ?? {}) as { summary?: string; messages?: string[] };
          return { key: t.key, role: t.role as DevTeamRoleName, title: t.title, summary: out.summary ?? '', messages: out.messages ?? [] };
        });
      const team = (await prisma.devTeamMessage.findMany({ where: { runId }, orderBy: { createdAt: 'desc' }, take: 12 }))
        .reverse()
        .map((m) => ({ role: (m.role as DevTeamRoleName | null) ?? null, text: m.content }));

      const hints = ((task.input ?? {}) as { files?: string[] }).files ?? [];
      const selected = selectFilesForTask({ role, hints, files: listed, maxFileBytes: limits.maxFileBytes });
      const provided: ProvidedFiles = new Map();
      const filesForPrompt: FileForPrompt[] = [];
      for (const pick of selected) {
        const snap = await readSnapshot(pick.path);
        if (!snap) continue;
        const flagged = detectInjection(snap.content);
        const editable = pick.editable && flagged.length === 0;
        if (flagged.length > 0 && pick.editable) {
          await addMessage(runId, { kind: 'SYSTEM', taskId: task.id, content: `${pick.path} contains instruction-like text, so it was shown read-only.` });
        }
        provideFile(provided, pick.path, snap.content, editable);
        filesForPrompt.push({ path: pick.path, content: snap.content, editable });
      }

      const call = buildTaskCall({
        role,
        goal: run.goal,
        task: { key: task.key, title: task.title, description: task.description },
        brief,
        dependencies,
        files: filesForPrompt,
        team,
        contextTokenBudget: limits.contextTokenBudget,
        dependencyTokenBudget: limits.dependencyTokenBudget,
      });
      if (call.flags.length > 0) {
        await addMessage(runId, { kind: 'SYSTEM', taskId: task.id, content: `Instruction-like text was neutralised in the context (${call.flags.join(', ')}).` });
      }

      let lastError = 'The role returned an unusable reply.';
      for (let attempt = 1; attempt <= limits.maxAttemptsPerTask; attempt++) {
        const reason = await stopReason(runId, projectId);
        if (reason) {
          lastError = reason;
          break;
        }
        if (!budget.canSpend(limits.taskCredits)) {
          lastError = 'The run budget was used up before this task could finish.';
          break;
        }
        await prisma.devTeamTask.update({ where: { id: task.id }, data: { attempts: attempt } });
        try {
          const reply = await withTimeout((signal) => callModel({ system: call.system, user: call.messages[0].content, maxTokens: 8000, signal }), limits.taskTimeoutMs);
          await budget.record(limits.taskCredits);
          const parsed = parseTaskOutput(reply.text, role, provided, existing, limits);
          if (!parsed) {
            lastError = 'The role did not return valid JSON.';
            continue;
          }

          const alreadyPlanned = await prisma.devTeamChangeProposal.findMany({ where: { runId }, select: { path: true }, distinct: ['path'] });
          const knownPaths = new Set(alreadyPlanned.map((p) => p.path));
          const accepted = parsed.proposals.filter((p) => {
            if (knownPaths.has(p.path) || knownPaths.size < limits.maxFilesPerRun) {
              knownPaths.add(p.path);
              return true;
            }
            parsed.rejected.push({ path: p.path, reason: `The run already touches ${limits.maxFilesPerRun} files.` });
            return false;
          });
          if (accepted.length > 0) {
            await prisma.devTeamChangeProposal.createMany({
              data: accepted.map((p) => ({
                runId,
                taskId: task.id,
                role,
                path: p.path,
                op: p.op,
                baseHash: p.baseHash,
                baseContent: p.baseContent,
                proposedContent: p.proposedContent,
                rationale: p.rationale,
              })),
            });
          }
          await prisma.devTeamTask.update({
            where: { id: task.id },
            data: { output: { summary: parsed.summary, messages: parsed.messages, files: accepted.map((p) => p.path) } as Prisma.InputJsonValue, error: null },
          });
          for (const text of parsed.messages) await addMessage(runId, { role, taskId: task.id, kind: 'HANDOFF', content: text });
          if (parsed.summary) await addMessage(runId, { role, taskId: task.id, kind: 'SUMMARY', content: parsed.summary });
          for (const r of parsed.rejected) {
            await addMessage(runId, { kind: 'BLOCKED', taskId: task.id, role, content: `Change to ${r.path} was not accepted: ${r.reason}` });
          }
          return 'DONE';
        } catch (error) {
          lastError = error instanceof Error && error.name === 'TaskTimeoutError' ? error.message : 'The model call failed.';
        }
      }
      await prisma.devTeamTask.update({ where: { id: task.id }, data: { error: lastError.slice(0, 500) } });
      return 'FAILED';
    };

    const result = await runSchedule(
      taskRows.map((t) => ({ key: t.key, dependsOn: t.dependsOn, status: 'PENDING' as SchedStatus })),
      {
        execute,
        concurrency: limits.concurrency,
        deadline: Date.now() + limits.runTimeoutMs,
        canContinue: async () => {
          const reason = await stopReason(runId, projectId);
          return reason ? { ok: false, reason } : { ok: true };
        },
        onStatus: async (key, status, reason) => {
          const task = byKey.get(key);
          if (!task) return;
          await prisma.devTeamTask.update({
            where: { id: task.id },
            data: {
              status,
              ...(status === 'RUNNING' ? { startedAt: new Date() } : {}),
              ...(status === 'DONE' || status === 'FAILED' || status === 'SKIPPED' || status === 'CANCELLED' ? { finishedAt: new Date() } : {}),
              ...(reason ? { error: reason } : {}),
            },
          });
        },
      },
    );

    const current = await prisma.devTeamRun.findFirst({ where: { id: runId, projectId }, select: { status: true } });
    if (!current || current.status === 'CANCELLED') {
      await finishCredits(runId, projectId, budget.spent, true);
      return;
    }
    const done = Object.values(result.statuses).filter((s) => s === 'DONE').length;
    if (done === 0) return void (await failRun(runId, projectId, result.stoppedReason ?? 'No task finished successfully.'));
    if (result.stoppedReason) await addMessage(runId, { kind: 'SYSTEM', content: `${result.stoppedReason} Unfinished tasks were cancelled.` });

    // 3. Merge, resolve, verify.
    await mergeRun(runId, projectId);
    await suggestResolutions({ runId, projectId, callModel, budget, limits });
    await verifyRun(runId, projectId);
    await finishCredits(runId, projectId, budget.spent, false);
  } catch (error) {
    console.error('[dev-team] run failed:', error);
    await reportFailure('dev-team.run', error, { tags: { job: 'dev-team' }, extra: { projectId, runId } }).catch(() => null);
    await failRun(runId, projectId, GENERIC_FAILURE);
  }
}

async function finishCredits(runId: string, projectId: string, spent: number, failed: boolean) {
  const run = await prisma.devTeamRun.findFirst({ where: { id: runId, projectId }, select: { creditKey: true, reservedCredits: true } });
  if (!run) return;
  await prisma.devTeamRun.update({ where: { id: runId }, data: { finishedAt: new Date() } });
  const settled = await settleRunCredits({ creditKey: run.creditKey, reserved: run.reservedCredits, spent, failed }).catch((e) => {
    console.error('[dev-team] settle failed:', e);
    return { refunded: 0 };
  });
  if (settled.refunded > 0) await addMessage(runId, { kind: 'SYSTEM', content: `${settled.refunded} unused credits were returned.` });
}

function toProposal(p: { id: string; path: string; op: string; role: string; baseHash: string | null; baseContent: string | null; proposedContent: string | null; task?: { key: string } | null }): Proposal {
  return { id: p.id, role: p.role, taskKey: p.task?.key, path: p.path, op: p.op as Proposal['op'], baseHash: p.baseHash, baseContent: p.baseContent, proposedContent: p.proposedContent };
}

async function currentContent(projectId: string, artifactSlug: string, path: string): Promise<string | null> {
  const content = await readProjectFile(projectId, artifactSlug, path).catch(() => null);
  return typeof content === 'string' ? content : null;
}

/** Deterministically merges every proposal per file and stores the result. Conflicts are stored, never resolved silently. */
export async function mergeRun(runId: string, projectId: string): Promise<MergeResult[]> {
  const run = await prisma.devTeamRun.findFirst({ where: { id: runId, projectId }, select: { artifactSlug: true } });
  if (!run) return [];
  const rows = await prisma.devTeamChangeProposal.findMany({ where: { runId }, orderBy: { createdAt: 'asc' }, include: { task: { select: { key: true } } } });
  const merged = mergeProposals(rows.map(toProposal));

  const data = [];
  for (const m of merged) {
    const stale = m.status !== 'CONFLICT' && isStale(m, await currentContent(projectId, run.artifactSlug, m.path));
    data.push({
      runId,
      path: m.path,
      op: m.op,
      status: stale ? ('STALE' as const) : m.status,
      baseHash: m.baseHash,
      baseContent: m.baseContent,
      finalContent: m.finalContent,
      proposalIds: m.proposalIds,
      conflict: stale ? ({ reason: 'The file changed after the AI team read it.', details: [] } as Prisma.InputJsonValue) : m.conflict ? (m.conflict as Prisma.InputJsonValue) : undefined,
    });
  }
  await prisma.$transaction([prisma.devTeamMergedFile.deleteMany({ where: { runId } }), prisma.devTeamMergedFile.createMany({ data })]);
  const conflicts = data.filter((d) => d.status === 'CONFLICT');
  if (conflicts.length > 0) {
    await addMessage(runId, { kind: 'CONFLICT', content: `${conflicts.length} file(s) have conflicting proposals and need a decision: ${conflicts.map((c) => c.path).join(', ')}.` });
  }
  return merged;
}

/** Resolver step: the architect proposes a merged file for each conflicted MODIFY. It is only ever a suggestion a human must accept. */
export async function suggestResolutions(args: {
  runId: string;
  projectId: string;
  callModel: DevTeamModelCall;
  budget: { canSpend(n: number): boolean; record(n: number): Promise<void> };
  limits: DevTeamLimits;
}) {
  const { buildUntrustedCall } = await import('@/lib/agents/untrusted');
  const { extractJsonObject } = await import('./parse');
  const conflicts = await prisma.devTeamMergedFile.findMany({ where: { runId: args.runId, status: 'CONFLICT', op: 'MODIFY', baseContent: { not: null } }, take: 3 });
  for (const file of conflicts) {
    if (!args.budget.canSpend(args.limits.resolverCredits)) break;
    const proposals = await prisma.devTeamChangeProposal.findMany({ where: { id: { in: file.proposalIds }, runId: args.runId, proposedContent: { not: null } } });
    if (proposals.length < 2) continue;
    const call = buildUntrustedCall({
      system: `You are the ${DEV_TEAM_ROLE_LABELS.ARCHITECT.label} resolving a merge conflict between roles. You only return a merged file; a person will review it.`,
      task: ['Merge the versions below into ONE coherent file that keeps every role\'s intent.', 'Reply with ONE JSON object: {"content": "<complete merged file>", "explanation": "<max 300 chars>"}'].join('\n'),
      untrusted: [
        { label: 'original', content: file.baseContent ?? '', maxLength: args.limits.maxFileBytes },
        ...proposals.map((p, i) => ({ label: `version${i + 1}${p.role.toLowerCase()}`, content: p.proposedContent ?? '', maxLength: args.limits.maxFileBytes })),
      ],
    });
    try {
      const reply = await withTimeout((signal) => args.callModel({ system: call.system, user: call.messages[0].content, maxTokens: 8000, signal }), args.limits.taskTimeoutMs);
      await args.budget.record(args.limits.resolverCredits);
      const parsed = extractJsonObject(reply.text) as { content?: unknown; explanation?: unknown } | null;
      if (parsed && typeof parsed.content === 'string' && Buffer.byteLength(parsed.content) <= args.limits.maxFileBytes) {
        await prisma.devTeamMergedFile.update({ where: { id: file.id }, data: { suggestion: parsed.content } });
        await addMessage(args.runId, { role: 'ARCHITECT', kind: 'CONFLICT', content: `Suggested a merge for ${file.path}: ${typeof parsed.explanation === 'string' ? parsed.explanation : 'review the diff'}. It is only a suggestion until you accept it.` });
      }
    } catch {
      await addMessage(args.runId, { kind: 'SYSTEM', content: `The resolver could not suggest a merge for ${file.path}; please decide manually.` });
    }
  }
}

/** Re-checks staleness, runs the scan on the merged result and moves the run to the right review state. */
export async function verifyRun(runId: string, projectId: string): Promise<VerificationResult | null> {
  const run = await prisma.devTeamRun.findFirst({ where: { id: runId, projectId }, select: { artifactSlug: true, status: true } });
  if (!run || !['RUNNING', 'NEEDS_DECISION', 'AWAITING_APPROVAL'].includes(run.status)) return null;

  const files = await prisma.devTeamMergedFile.findMany({ where: { runId, appliedAt: null } });
  for (const file of files) {
    if (file.status === 'CONFLICT') continue;
    const stale = isStale({ baseHash: file.baseHash, op: file.op }, await currentContent(projectId, run.artifactSlug, file.path));
    const next = stale ? 'STALE' : file.status === 'STALE' ? (file.proposalIds.length > 1 ? 'MERGED' : 'CLEAN') : file.status;
    if (next !== file.status) {
      file.status = next;
      await prisma.devTeamMergedFile.update({ where: { id: file.id }, data: { status: next } });
    }
  }

  const [memories, baseline] = await Promise.all([listActiveMemories(projectId).catch(() => []), getLatestRegression(projectId).catch(() => null)]);
  const result = await verifyMerged({
    files,
    protectedFeatures: protectedFeaturesOf(memories).map((f) => ({ title: f.title, files: f.files })),
    matchesProtectedPath,
    baselineRegression: baseline ? { status: baseline.status, createdAt: baseline.createdAt } : null,
  });
  const nextStatus = result.unresolvedFiles.length > 0 ? 'NEEDS_DECISION' : 'AWAITING_APPROVAL';
  await prisma.devTeamRun.updateMany({
    where: { id: runId, projectId, status: { in: ['RUNNING', 'NEEDS_DECISION', 'AWAITING_APPROVAL'] } },
    data: { status: nextStatus, verification: result as unknown as Prisma.InputJsonValue, verifiedAt: new Date() },
  });
  return result;
}
