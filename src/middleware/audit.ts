import type { Request } from 'express';
import { AuditLog } from '@/models/auditLog.model';
import { logger } from '@/lib/logger';

/**
 * Records an admin mutation. Called from service code rather than as route
 * middleware, because only the service knows the before and after states.
 *
 * Deliberately fire-and-forget: a logging failure must never roll back the
 * business action that succeeded.
 */
export function recordAudit(
  req: Request,
  entry: {
    action: string;
    entity: string;
    entityId?: unknown;
    before?: unknown;
    after?: unknown;
  },
): void {
  if (!req.admin) return;

  AuditLog.create({
    adminId: req.admin.id,
    adminName: req.admin.name,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    before: entry.before,
    after: entry.after,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    at: new Date(),
  }).catch((err) => {
    logger.error({ err, action: entry.action }, 'Failed to write audit log');
  });
}
