import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/index.js';
import { now } from '../../../common/index.js';
import { unwrapResult } from '../../../common/result/index.js';
import { AuditLogService } from '../../audit-log/index.js';

/**
 * Admin revoke of another user's clinic-summary share link.
 *
 * The write is issued directly against `user_clinic_summary_share` rather than
 * routed through the `reports` module's `ShareService`: `reports` reaches
 * `product-events`, which imports `AdminModule` (for `AdminGuard`), so an
 * `AdminModule → ReportsModule` import would form a module cycle. The domain
 * consequence is deliberate — an administrative revoke must not emit the
 * user-facing `visit_summary_share_revoked` telemetry event, which is why only
 * the `revokedAt` mutation (plus an audit entry) is performed here.
 */
@Injectable()
export class AdminSharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Revokes a share owned by `userId`. Returns `false` only when the share does
   * not exist or belongs to a different user; re-revoking an already-revoked
   * share is an idempotent success.
   */
  async revoke(
    actorUserId: string,
    userId: string,
    shareId: string,
  ): Promise<boolean> {
    const share = await this.prisma.userClinicSummaryShare.findFirst({
      where: { id: shareId, userId },
      select: { id: true, revokedAt: true },
    });
    if (share === null) return false;

    if (share.revokedAt !== null) return true;

    await this.prisma.userClinicSummaryShare.update({
      where: { id: shareId },
      data: { revokedAt: now() },
    });
    await unwrapResult(
      this.auditLog.log({
        userId: actorUserId,
        action: 'admin.users.shares.revoke',
        resourceType: 'user_clinic_summary_share',
        resourceId: shareId,
        metadata: { targetUserId: userId },
      }),
    );
    return true;
  }
}
