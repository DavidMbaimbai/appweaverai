import { prisma } from '@/lib/prisma';
import type {
  SecurityEventSeverity,
  SecurityEventType,
} from '@/lib/generated/prisma/client';

type SecurityEventInput = {
  type: SecurityEventType;
  severity?: SecurityEventSeverity;
  subjectType: string;
  subjectId?: string | null;
  message: string;
  metadata?: unknown;
  ipAddress?: string | null;
};

/** Records a security signal (ADM-091). Best-effort, never throws. */
export async function recordSecurityEvent(input: SecurityEventInput) {
  try {
    await prisma.securityEvent.create({
      data: {
        type: input.type,
        severity: input.severity ?? 'INFO',
        subjectType: input.subjectType,
        subjectId: input.subjectId ?? null,
        message: input.message,
        metadata:
          input.metadata !== undefined
            ? JSON.parse(JSON.stringify(input.metadata))
            : undefined,
        ipAddress: input.ipAddress ?? null,
      },
    });
  } catch (error) {
    console.error('Failed to record security event:', error);
  }
}
