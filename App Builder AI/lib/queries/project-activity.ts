import { prisma } from '@/lib/prisma';
import type { AgentMessageMetadata } from '@/lib/agent/types';

/**
 * Powers the editor's "Build & Activity Log" panel — a live, read-only feed
 * of everything happening on a project, combining:
 *   1. Agent build steps (from AgentMessage.metadata, already captured by
 *      the agent loop — see app/api/projects/[projectId]/agent/route.ts)
 *   2. Higher-level lifecycle activity (publish, GitHub export, custom
 *      domain, remix, trash, etc. — already recorded via
 *      lib/activity/record-user-activity.ts into AdminAuditLog)
 *
 * This gives users terminal-like visibility into "what the AI is doing and
 * what happened to my project" without needing an actual shell — a good
 * fit for an app builder that produces static file bundles rather than
 * running each project in its own dev container.
 */

export type ProjectActivityEntry =
  | {
      kind: 'build';
      id: string;
      createdAt: string;
      summary: string;
      buildValid: boolean | null;
      fileWrites: Array<{ path: string }>;
      authorName: string | null;
    }
  | {
      kind: 'activity';
      id: string;
      createdAt: string;
      action: string;
      actorEmail: string | null;
    };

const ACTIVITY_LABELS: Record<string, string> = {
  'project.created': 'Project created',
  'project.moved_to_trash': 'Moved to trash',
  'project.restored': 'Restored from trash',
  'project.permanently_deleted': 'Permanently deleted',
  'project.remixed': 'Remixed into a new project',
  'project.github_exported': 'Exported to GitHub',
  'project.github_disconnected': 'GitHub connection removed',
  'project.custom_domain_set': 'Custom domain connected',
  'project.custom_domain_removed': 'Custom domain removed',
  'project.custom_domain_verified': 'Custom domain verified',
};

export function describeProjectActivityAction(action: string) {
  return ACTIVITY_LABELS[action] ?? action.replace(/[._]/g, ' ');
}

export async function listProjectActivity(
  projectId: string,
  { limit = 40 }: { limit?: number } = {},
): Promise<ProjectActivityEntry[]> {
  const [messages, auditLogs] = await Promise.all([
    prisma.agentMessage.findMany({
      where: {
        role: 'ASSISTANT',
        conversation: { projectId },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        content: true,
        metadata: true,
        createdAt: true,
        conversation: { select: { user: { select: { name: true } } } },
      },
    }),
    prisma.adminAuditLog.findMany({
      where: {
        targetType: 'Project',
        targetId: projectId,
        action: { not: { startsWith: 'account.' } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        action: true,
        adminEmail: true,
        createdAt: true,
      },
    }),
  ]);

  const buildEntries: ProjectActivityEntry[] = messages.map((message) => {
    const metadata = (message.metadata ?? {}) as AgentMessageMetadata;
    return {
      kind: 'build',
      id: message.id,
      createdAt: message.createdAt.toISOString(),
      summary: message.content.split('\n')[0]?.slice(0, 160) || 'Agent update',
      buildValid: metadata.buildValid ?? null,
      fileWrites: (metadata.fileWrites ?? []).map((f) => ({ path: f.path })),
      authorName: message.conversation.user.name ?? null,
    };
  });

  const activityEntries: ProjectActivityEntry[] = auditLogs.map((log) => ({
    kind: 'activity',
    id: log.id,
    createdAt: log.createdAt.toISOString(),
    action: log.action,
    actorEmail: log.adminEmail,
  }));

  return [...buildEntries, ...activityEntries]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}
