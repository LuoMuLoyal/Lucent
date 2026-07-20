import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { toNullableInputJsonValue } from '../../../common/helpers/json.utils';

/** Input for a single audit log entry. */
export interface AuditLogEntry {
  userId: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Writes security-sensitive operation records to the `audit_logs` table.
 *
 * Designed to be **fire-and-forget**: callers invoke `log()` without
 * awaiting so the request path is never blocked by audit persistence.
 * Write failures are logged as warnings but never propagated — audit
 * logging must not break the user-facing operation.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists an audit log entry. Never throws — failures are swallowed
   * and logged so that the calling operation is unaffected.
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId,
          action: entry.action,
          resourceType: entry.resourceType ?? null,
          resourceId: entry.resourceId ?? null,
          metadata: toNullableInputJsonValue(entry.metadata ?? null),
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to write audit log (action=${entry.action}, userId=${entry.userId}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Convenience wrapper that logs and does not await — use this from
   * controller methods where the audit write should not block the
   * response.
   */
  logFireAndForget(entry: AuditLogEntry): void {
    void this.log(entry);
  }
}
