import { prisma } from './prisma.js';

export interface AuditInput {
  restaurantId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

export async function recordAuditLog(input: AuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      restaurantId: input.restaurantId,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
      ipAddress: input.ipAddress ?? null,
    },
  });
}
