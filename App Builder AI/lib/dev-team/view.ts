import { isGloballyPaused } from '@/lib/agents/pause';
import { prisma } from '@/lib/prisma';

import { estimateForUser, reapStaleRuns } from './lifecycle';
import { lineDiff, type DiffRow } from './merge';
import type { VerificationResult } from './verify';
import type { DevTeamEstimate } from './credits';
import { ESTIMATE_DISCLAIMER } from '@/lib/credits/estimate';

export type TeamTaskView = { key: string; role: string; title: string; status: string; dependsOn: string[]; summary: string; error: string | null; attempts: number };
export type TeamMessageView = { id: string; role: string | null; kind: string; content: string; createdAt: string };
export type TeamFileView = {
  id: string;
  path: string;
  op: string;
  status: string;
  conflictReason: string | null;
  hasSuggestion: boolean;
  rows: DiffRow[];
  truncated: boolean;
  proposals: Array<{ id: string; role: string; rationale: string }>;
};
export type TeamRunView = {
  id: string;
  goal: string;
  status: string;
  planSummary: string | null;
  error: string | null;
  reservedCredits: number;
  spentCredits: number;
  createdAt: string;
  decisionReason: string | null;
  verification: VerificationResult | null;
  tasks: TeamTaskView[];
  messages: TeamMessageView[];
  files: TeamFileView[];
};
export type TeamPageData = {
  paused: boolean;
  estimate: DevTeamEstimate;
  disclaimer: string;
  run: TeamRunView | null;
  history: Array<{ id: string; goal: string; status: string; createdAt: string }>;
};

const MAX_DIFF_ROWS = 400;

export async function loadTeamPage(args: { projectId: string; userId: string; workspaceId: string }): Promise<TeamPageData> {
  await reapStaleRuns(args.projectId).catch(() => null);
  const [paused, estimate, latest, history] = await Promise.all([
    isGloballyPaused(),
    estimateForUser(args.userId, args.workspaceId),
    prisma.devTeamRun.findFirst({
      where: { projectId: args.projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        tasks: { orderBy: { createdAt: 'asc' } },
        messages: { orderBy: { createdAt: 'asc' }, take: 200 },
        files: { orderBy: { path: 'asc' } },
        proposals: { select: { id: true, path: true, role: true, rationale: true } },
      },
    }),
    prisma.devTeamRun.findMany({ where: { projectId: args.projectId }, orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, goal: true, status: true, createdAt: true } }),
  ]);

  const run: TeamRunView | null = latest
    ? {
        id: latest.id,
        goal: latest.goal,
        status: latest.status,
        planSummary: latest.planSummary,
        error: latest.error,
        reservedCredits: latest.reservedCredits,
        spentCredits: latest.spentCredits,
        createdAt: latest.createdAt.toISOString(),
        decisionReason: latest.decisionReason,
        verification: (latest.verification as VerificationResult | null) ?? null,
        tasks: latest.tasks.map((t) => ({
          key: t.key,
          role: t.role,
          title: t.title,
          status: t.status,
          dependsOn: t.dependsOn,
          summary: ((t.output ?? {}) as { summary?: string }).summary ?? '',
          error: t.error,
          attempts: t.attempts,
        })),
        messages: latest.messages.map((m) => ({ id: m.id, role: m.role, kind: m.kind, content: m.content, createdAt: m.createdAt.toISOString() })),
        files: latest.files.map((f) => {
          const rows = lineDiff(f.baseContent ?? '', f.op === 'DELETE' ? '' : (f.finalContent ?? f.suggestion ?? ''));
          const conflict = (f.conflict ?? null) as { reason?: string } | null;
          return {
            id: f.id,
            path: f.path,
            op: f.op,
            status: f.status,
            conflictReason: conflict?.reason ?? null,
            hasSuggestion: Boolean(f.suggestion),
            rows: rows.slice(0, MAX_DIFF_ROWS),
            truncated: rows.length > MAX_DIFF_ROWS,
            proposals: latest.proposals.filter((p) => f.proposalIds.includes(p.id)).map((p) => ({ id: p.id, role: p.role, rationale: p.rationale })),
          };
        }),
      }
    : null;

  return {
    paused,
    estimate,
    disclaimer: ESTIMATE_DISCLAIMER,
    run,
    history: history.map((h) => ({ id: h.id, goal: h.goal, status: h.status, createdAt: h.createdAt.toISOString() })),
  };
}
