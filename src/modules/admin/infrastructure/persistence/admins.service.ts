import { Injectable } from '@nestjs/common';
import { AdminRole, UserStatus } from '#generated/prisma/client.js';
import { PrismaService } from '../../../../prisma/index.js';
import {
  createDomainFailure,
  DomainFailureException,
  unwrapResult,
} from '../../../../common/result/index.js';
import { AuditLogService } from '../../../audit-log/index.js';
import type { AdminAdminSummaryDto } from '../../application/ports/admin-admins.js';

export type AdminRoleSetOutcome =
  | { status: 'ok'; admin: AdminAdminSummaryDto }
  | { status: 'self' }
  | { status: 'user_not_found' }
  | { status: 'last_super_admin' };

export type AdminRemoveOutcome =
  | 'ok'
  | 'not_found'
  | 'self'
  | 'last_super_admin';

interface AdminGrantRow {
  userId: string;
  role: AdminRole;
  createdAt: Date;
  updatedAt: Date;
  user: { email: string | null; nickname: string | null; status: UserStatus };
}

/**
 * @throws {DomainFailureException} when the grantee has no email — an admin
 *   account without a deliverable address cannot be audited or recovered, so
 *   granting a role to one is rejected rather than rendering a null in the
 *   console. (OAuth-only users can have `email: null` since the column became
 *   nullable.)
 */
function toSummary(row: AdminGrantRow): AdminAdminSummaryDto {
  if (row.user.email === null) {
    throw new DomainFailureException(
      createDomainFailure({
        kind: 'conflict',
        code: 'RESOURCE_CONFLICT',
        detail:
          'Cannot grant an admin role to an account without an email address',
      }),
    );
  }

  return {
    userId: row.userId,
    email: row.user.email,
    nickname: row.user.nickname,
    userStatus: row.user.status,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const GRANT_SELECT = {
  userId: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { email: true, nickname: true, status: true } },
} as const;

/**
 * Owner of the `admin_users` table — the admin console writes RBAC grants here.
 * Enforces the two invariants that keep the console from locking itself out:
 * an actor can never change or remove its own role, and the last remaining
 * SUPER_ADMIN can never be demoted or removed.
 */
@Injectable()
export class AdminAdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(): Promise<{ items: AdminAdminSummaryDto[]; total: number }> {
    const rows = await this.prisma.adminUser.findMany({
      select: GRANT_SELECT,
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
    });
    return { items: rows.map(toSummary), total: rows.length };
  }

  async getRole(userId: string): Promise<AdminRole | null> {
    const grant = await this.prisma.adminUser.findUnique({
      where: { userId },
      select: { role: true },
    });
    return grant?.role ?? null;
  }

  async isSuperAdmin(userId: string): Promise<boolean> {
    return (await this.getRole(userId)) === AdminRole.SUPER_ADMIN;
  }

  async getOne(userId: string): Promise<AdminAdminSummaryDto | null> {
    const row = await this.prisma.adminUser.findUnique({
      where: { userId },
      select: GRANT_SELECT,
    });
    return row === null ? null : toSummary(row);
  }

  /** Creates or replaces the grant for `targetUserId`. */
  async setRole(
    actorUserId: string,
    targetUserId: string,
    role: AdminRole,
  ): Promise<AdminRoleSetOutcome> {
    if (actorUserId === targetUserId) return { status: 'self' };

    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, status: { not: UserStatus.deleted } },
      select: { id: true },
    });
    if (target === null) return { status: 'user_not_found' };

    const existing = await this.prisma.adminUser.findUnique({
      where: { userId: targetUserId },
      select: { role: true },
    });

    if (existing?.role === AdminRole.SUPER_ADMIN && role !== AdminRole.SUPER_ADMIN) {
      if (await this.isLastSuperAdmin(targetUserId)) {
        return { status: 'last_super_admin' };
      }
    }

    await this.prisma.adminUser.upsert({
      where: { userId: targetUserId },
      create: { userId: targetUserId, role },
      update: { role },
    });
    await unwrapResult(
      this.auditLog.log({
        userId: actorUserId,
        action: 'admin.admins.role.set',
        resourceType: 'admin_user',
        resourceId: targetUserId,
        metadata: { before: existing?.role ?? null, after: role },
      }),
    );

    const admin = await this.getOne(targetUserId);
    if (admin === null) return { status: 'user_not_found' };
    return { status: 'ok', admin };
  }

  /** Removes the grant for `targetUserId`. */
  async remove(
    actorUserId: string,
    targetUserId: string,
  ): Promise<AdminRemoveOutcome> {
    if (actorUserId === targetUserId) return 'self';

    const existing = await this.prisma.adminUser.findUnique({
      where: { userId: targetUserId },
      select: { role: true },
    });
    if (existing === null) return 'not_found';

    if (
      existing.role === AdminRole.SUPER_ADMIN &&
      (await this.isLastSuperAdmin(targetUserId))
    ) {
      return 'last_super_admin';
    }

    await this.prisma.adminUser.delete({ where: { userId: targetUserId } });
    await unwrapResult(
      this.auditLog.log({
        userId: actorUserId,
        action: 'admin.admins.remove',
        resourceType: 'admin_user',
        resourceId: targetUserId,
        metadata: { before: existing.role, after: null },
      }),
    );
    return 'ok';
  }

  private async isLastSuperAdmin(userId: string): Promise<boolean> {
    const others = await this.prisma.adminUser.count({
      where: { role: AdminRole.SUPER_ADMIN, userId: { not: userId } },
    });
    return others === 0;
  }
}
