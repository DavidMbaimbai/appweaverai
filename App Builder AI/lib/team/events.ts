import { recordUserActivity } from '@/lib/activity/record-user-activity';

export type TeamEventTarget =
  | { type: 'Project'; id: string }
  | { type: 'Workspace'; id: string };

/** Audit + activity-feed event (AdminAuditLog via recordUserActivity). Project events show in the project feed. */
export async function recordTeamEvent(input: {
  actorId: string;
  action: string;
  target: TeamEventTarget;
  before?: unknown;
  after?: unknown;
}) {
  await recordUserActivity({
    userId: input.actorId,
    action: input.action,
    targetType: input.target.type,
    targetId: input.target.id,
    before: input.before,
    after: input.after,
  });
}
