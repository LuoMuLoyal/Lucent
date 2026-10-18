import { Injectable } from '@nestjs/common';
import { UserStatus } from '#generated/prisma/client.js';
import { PrismaService } from '../../../prisma/index.js';
import { now } from '../../../common/index.js';
import { unwrapResult } from '../../../common/result/index.js';
import { AuditLogService } from '../../audit-log/index.js';

/** Admin-settable lifecycle states. `deleted` is only reachable via softDelete. */
export type AdminUserStatus = Extract<UserStatus, 'active' | 'suspended'>;

export interface UserStatusChange {
  userId: string;
  before: UserStatus;
  after: UserStatus;
}

/**
 * Owner-module write surface for administrative user-account lifecycle
 * operations. The admin console reads users through `AdminConsoleService`, but
 * every write lands here so the `user` module stays the single writer for its
 * table (ADR-0009). Audit entries are written inline so the caller cannot forget
 * them.
 */
@Injectable()
export class UserAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Sets a user's status to `active` or `suspended`. Returns `null` when the
   * user does not exist or is already soft-deleted.
   */
  async setStatus(
    actorUserId: string,
    userId: string,
    status: AdminUserStatus,
  ): Promise<UserStatusChange | null> {
    const before = await this.prisma.user.findFirst({
      where: { id: userId, status: { not: UserStatus.deleted } },
      select: { status: true },
    });
    if (before === null) return null;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status },
      select: { status: true },
    });
    await unwrapResult(
      this.auditLog.log({
        userId: actorUserId,
        action: 'admin.users.status.update',
        resourceType: 'user',
        resourceId: userId,
        metadata: { before: before.status, after: updated.status },
      }),
    );
    return { userId, before: before.status, after: updated.status };
  }

  /**
   * Soft-deletes a user (status `deleted` + `deletedAt`). Returns `false` when
   * the user does not exist or was already deleted.
   */
  async softDelete(actorUserId: string, userId: string): Promise<boolean> {
    const before = await this.prisma.user.findFirst({
      where: { id: userId, status: { not: UserStatus.deleted } },
      select: { status: true },
    });
    if (before === null) return false;

    await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.deleted, deletedAt: now() },
    });
    await unwrapResult(
      this.auditLog.log({
        userId: actorUserId,
        action: 'admin.users.delete',
        resourceType: 'user',
        resourceId: userId,
        metadata: { before: before.status, after: UserStatus.deleted },
      }),
    );
    return true;
  }
}
