import { Injectable } from '@nestjs/common';

import type { Prisma } from '#generated/prisma/client.js';
import { UserNotificationType } from '#generated/prisma/client.js';
import { PrismaService } from '../../../../prisma/index.js';
import { now, toInputJsonValue } from '../../../../common/index.js';
import {
  createDomainFailure,
  DomainFailureException,
} from '../../../../common/result/index.js';
import { matchesScope } from '../../domain/notification/notification.js';
import type {
  NewNotification,
  NotificationRow,
  NotificationScope,
} from '../../domain/notification/notification.js';
import { Notifications } from '../../application/ports/notifications.js';

/** 读侧固定选取的列。 */
const ROW_SELECT = {
  id: true,
  type: true,
  title: true,
  content: true,
  action: true,
  actionPayload: true,
  isRead: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.UserNotificationSelect;

/**
 * `Notifications` 端口的 Prisma 实现。
 *
 * ## `createOrReplaceScoped` 的两条路径
 *
 * 1. **有 `scopeKey`** → 走唯一约束 `(userId, type, scopeKey)` 的 upsert。
 *    由数据库保证唯一性，一次往返。
 * 2. **无 `scopeKey`** → 取该用户同 type 的最近 50 条，用
 *    `matchesScope`（`domain/` 里的纯函数）挑出同作用域的，删掉再插。
 *
 * 第二条路径是**历史包袱**：老调用方只填 `actionPayload` 里的
 * `{source,date}`，没有 `scopeKey` 列。两条路径必须都保留，否则老调用方的
 * 重复通知会重新出现。
 */
@Injectable()
export class PrismaNotifications extends Notifications {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(
    userId: string,
    input: NewNotification,
  ): Promise<NotificationRow> {
    try {
      return await this.prisma.userNotification.create({
        data: this.toCreateInput(userId, input),
        select: ROW_SELECT,
      });
    } catch (error) {
      throw infraFailure(error, 'Failed to create notification');
    }
  }

  async createOrReplaceScoped(
    userId: string,
    input: NewNotification,
    scope: NotificationScope,
  ): Promise<NotificationRow> {
    try {
      return await this.prisma.$transaction<NotificationRow>(async (tx) => {
        if (scope.scopeKey != null) {
          return await tx.userNotification.upsert({
            where: {
              userId_type_scopeKey: {
                userId,
                type: input.type as UserNotificationType,
                scopeKey: scope.scopeKey,
              },
            },
            update: this.toUpdateInput(input),
            create: {
              ...this.toCreateInput(userId, input),
              scopeKey: scope.scopeKey,
            },
            select: ROW_SELECT,
          });
        }

        const existing = await tx.userNotification.findMany({
          where: { userId, type: input.type as never },
          select: ROW_SELECT,
          orderBy: { createdAt: 'desc' },
          take: SCOPE_SCAN_LIMIT,
        });

        const duplicateIds = existing
          .filter((row) => matchesScope(row.actionPayload, scope))
          .map((row) => row.id)
          .slice(0, SCOPE_SCAN_LIMIT);

        if (duplicateIds.length > 0) {
          await tx.userNotification.deleteMany({
            where: { userId, id: { in: duplicateIds } },
          });
        }

        return await tx.userNotification.create({
          data: this.toCreateInput(userId, input),
          select: ROW_SELECT,
        });
      });
    } catch (error) {
      throw infraFailure(error, 'Failed to create scoped notification');
    }
  }

  async list(
    userId: string,
    page: { page: number; pageSize: number },
  ): Promise<{ items: NotificationRow[]; total: number }> {
    try {
      const [items, total] = await Promise.all([
        this.prisma.userNotification.findMany({
          where: { userId },
          select: ROW_SELECT,
          orderBy: { createdAt: 'desc' },
          skip: (page.page - 1) * page.pageSize,
          take: page.pageSize,
        }),
        this.prisma.userNotification.count({ where: { userId } }),
      ]);
      return { items, total };
    } catch (error) {
      throw infraFailure(error, 'Failed to list notifications');
    }
  }

  async findById(userId: string, id: string): Promise<NotificationRow | null> {
    try {
      return await this.prisma.userNotification.findFirst({
        where: { id, userId },
        select: ROW_SELECT,
      });
    } catch (error) {
      throw infraFailure(error, 'Failed to load notification');
    }
  }

  async markRead(userId: string, id: string): Promise<void> {
    try {
      await this.prisma.userNotification.updateMany({
        where: { id, userId, isRead: false },
        data: { isRead: true, readAt: now() },
      });
    } catch (error) {
      throw infraFailure(error, 'Failed to mark notification as read');
    }
  }

  async markUnread(userId: string, id: string): Promise<void> {
    try {
      await this.prisma.userNotification.updateMany({
        where: { id, userId },
        data: { isRead: false, readAt: null },
      });
    } catch (error) {
      throw infraFailure(error, 'Failed to mark notification as unread');
    }
  }

  async markAllRead(userId: string): Promise<number> {
    try {
      const result = await this.prisma.userNotification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true, readAt: now() },
      });
      return result.count;
    } catch (error) {
      throw infraFailure(error, 'Failed to mark all notifications as read');
    }
  }

  async remove(userId: string, id: string): Promise<boolean> {
    try {
      const result = await this.prisma.userNotification.deleteMany({
        where: { id, userId },
      });
      return result.count > 0;
    } catch (error) {
      throw infraFailure(error, 'Failed to delete notification');
    }
  }

  async unreadCount(userId: string): Promise<number> {
    try {
      return await this.prisma.userNotification.count({
        where: { userId, isRead: false },
      });
    } catch (error) {
      throw infraFailure(error, 'Failed to count unread notifications');
    }
  }

  private toCreateInput(
    userId: string,
    input: NewNotification,
  ): Prisma.UserNotificationCreateInput {
    return {
      user: { connect: { id: userId } },
      type: input.type as UserNotificationType,
      title: input.title,
      content: input.content,
      action: input.action ?? null,
      actionPayload: toInputJsonValue(input.actionPayload ?? null),
    };
  }

  private toUpdateInput(
    input: NewNotification,
  ): Prisma.UserNotificationUpdateInput {
    return {
      title: input.title,
      content: input.content,
      action: input.action ?? null,
      actionPayload: toInputJsonValue(input.actionPayload ?? null),
    };
  }
}

/** 无 `scopeKey` 路径下扫描的已有通知条数上限。 */
const SCOPE_SCAN_LIMIT = 50;

function infraFailure(error: unknown, context: string): Error {
  return new DomainFailureException(
    createDomainFailure({
      kind: 'dependency',
      code: 'DEPENDENCY_UNAVAILABLE',
      detail: context,
      cause: error,
    }),
  );
}
