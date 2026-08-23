import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma';
import { fromPrismaResult, toNullableInputJsonValue } from '../../../common';
import type { DomainFailure, ResultAsync } from '../../../common/result';
import { MetricsService } from '../../../common/metrics/metrics.service';

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
 * `log()` returns a `ResultAsync<void, DomainFailure>` (known Prisma request
 * errors map via `fromPrismaResult`; unknown DB/connection errors rethrow).
 * Callers that may await the outcome can handle the Err explicitly.
 *
 * `logFireAndForget` is the fire-and-forget contract: callers invoke it
 * without awaiting so the request path is never blocked by audit persistence.
 * Failures are never propagated — each one records a structured warn log and
 * increments the audit-write failure metric, so a silent audit gap stays
 * observable (Task 9 constraint: fire-and-forget requires failure metric +
 * structured log + main flow not blocked).
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Persists an audit log entry. Known Prisma request errors are mapped to
   * DomainFailure; unknown errors rethrow (the fire-and-forget wrapper folds
   * both outcomes).
   */
  log(entry: AuditLogEntry): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.auditLog.create({
        data: {
          userId: entry.userId,
          action: entry.action,
          resourceType: entry.resourceType ?? null,
          resourceId: entry.resourceId ?? null,
          metadata: toNullableInputJsonValue(entry.metadata ?? null),
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
        },
      }),
    ).map(() => undefined);
  }

  /**
   * Convenience wrapper that logs and does not await — use this from
   * controller methods where the audit write should not block the
   * response. Both Err and rejected outcomes are folded into a structured
   * warn log + failure metric; the caller flow is never affected.
   */
  logFireAndForget(entry: AuditLogEntry): void {
    this.log(entry)
      .match(
        () => undefined,
        (failure) => {
          this.logWriteFailure(entry, failure.code);
          this.metrics.recordAuditLogWriteFailure(entry.action);
        },
      )
      .catch((error: unknown) => {
        this.logWriteFailure(
          entry,
          error instanceof Error ? error.message : String(error),
        );
        this.metrics.recordAuditLogWriteFailure(entry.action);
      });
  }

  private logWriteFailure(entry: AuditLogEntry, reason: string): void {
    this.logger.warn(
      `Failed to write audit log (action=${entry.action}, userId=${entry.userId}): ${reason}`,
    );
  }
}
