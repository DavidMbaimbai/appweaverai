export const NOTIFICATION_KINDS = [
  'MENTION',
  'ASSIGNMENT',
  'APPROVAL_REQUESTED',
  'APPROVAL_DECIDED',
  'INVITATION',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_LABELS: Record<NotificationKind, string> = {
  MENTION: 'Mentions',
  ASSIGNMENT: 'Task assignments',
  APPROVAL_REQUESTED: 'Approval requests',
  APPROVAL_DECIDED: 'Approval decisions',
  INVITATION: 'Invitations',
};
