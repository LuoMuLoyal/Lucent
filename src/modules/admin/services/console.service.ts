import { Prisma, UserStatus } from '#generated/prisma/client.js';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/index.js';
import { AuditLogService } from '../../audit-log/index.js';
import type { AuditLogListQuery } from '../../audit-log/index.js';
import type { AdminAuditLogListQueryDto } from '../dto/admin-audit-logs.dto.js';
import type { AdminUserListQueryDto } from '../dto/admin-users.dto.js';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const NEW_USER_WINDOW_DAYS = 30;
const PRODUCT_EVENT_WINDOW_HOURS = 24;

@Injectable()
export class AdminConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getOverview() {
    const now = new Date();
    const newUserSince = new Date(
      now.getTime() - NEW_USER_WINDOW_DAYS * MS_PER_DAY,
    );
    const productEventsSince = new Date(
      now.getTime() - PRODUCT_EVENT_WINDOW_HOURS * MS_PER_HOUR,
    );

    const [active, suspended, newLast30Days, productEventsLast24Hours] =
      await Promise.all([
        this.prisma.nonDeleted.user.count({
          where: { status: UserStatus.active },
        }),
        this.prisma.nonDeleted.user.count({
          where: { status: UserStatus.suspended },
        }),
        this.prisma.nonDeleted.user.count({
          where: {
            status: { not: UserStatus.deleted },
            createdAt: { gte: newUserSince },
          },
        }),
        this.prisma.userProductEvent.count({
          where: { occurredAt: { gte: productEventsSince } },
        }),
      ]);

    return {
      generatedAt: now.toISOString(),
      users: { total: active + suspended, active, suspended, newLast30Days },
      productEventsLast24Hours,
    };
  }

  async listUsers(query: AdminUserListQueryDto) {
    const where: Prisma.UserWhereInput = {
      status: query.status ?? { not: UserStatus.deleted },
      ...(query.q === undefined
        ? {}
        : {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' } },
              { nickname: { contains: query.q, mode: 'insensitive' } },
            ],
          }),
    };
    const [users, total] = await Promise.all([
      this.prisma.nonDeleted.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          nickname: true,
          status: true,
          emailVerified: true,
          createdAt: true,
          lastLoginAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.nonDeleted.user.count({ where }),
    ]);

    const adminGrants =
      users.length === 0
        ? []
        : await this.prisma.adminUser.findMany({
            where: { userId: { in: users.map((user) => user.id) } },
            select: { userId: true, role: true },
          });
    const rolesByUserId = new Map(
      adminGrants.map((grant) => [grant.userId, grant.role]),
    );

    return {
      items: users.map((user) => ({
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        status: user.status,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        adminRole: rolesByUserId.get(user.id) ?? null,
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async getUser(id: string) {
    const user = await this.prisma.nonDeleted.user.findFirst({
      where: { id, status: { not: UserStatus.deleted } },
      select: {
        id: true,
        email: true,
        nickname: true,
        status: true,
        emailVerified: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
    if (user === null) {
      return null;
    }
    const adminGrant = await this.prisma.adminUser.findUnique({
      where: { userId: id },
      select: { role: true },
    });

    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      status: user.status,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      adminRole: adminGrant?.role ?? null,
    };
  }

  async listAuditLogs(query: AdminAuditLogListQueryDto) {
    const auditQuery: AuditLogListQuery = {
      page: query.page,
      limit: query.limit,
      ...(query.actorUserId === undefined ? {} : { userId: query.actorUserId }),
      ...(query.action === undefined ? {} : { action: query.action }),
      ...(query.resourceType === undefined
        ? {}
        : { resourceType: query.resourceType }),
    };
    const result = await this.auditLogService.listEntries(auditQuery);
    return {
      ...result,
      items: result.items.map(({ userId, ...entry }) => ({
        ...entry,
        actorUserId: userId,
      })),
    };
  }
}
