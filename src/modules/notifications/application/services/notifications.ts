import { Injectable } from '@nestjs/common';

import {
  createDomainFailure,
  errAsync,
  fromPromise,
  mapUnknownToDependencyFailure,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import type {
  NotificationDetail,
  NotificationItem,
} from '../commands/notification.js';
import type {
  NewNotification,
  NotificationRow,
  NotificationScope,
} from '../../domain/notification/notification.js';
import { Notifications } from '../ports/notifications.js';

export type { NotificationScope };

/**
 * 通知的应用服务 —— **类名保持不变**。
 *
 * ## 为什么保留名字
 *
 * 6 个模块经 barrel 用它（`today-suggestion` / `today-analysis` / `auth` /
 * `medicine-reminders` / `data-export` / `notification-preferences`）。
 * 四层化是内部结构调整，**不该传导成调用方的编译改动**。
 *
 * ## 分层
 *
 * IO 走 `Notifications` 端口，**不直连 Prisma**。幂等替换的规则在
 * `domain/notification/notification.ts`（`matchesScope` 是纯函数，可独立测）；
 * 作用域两条路径的选择在端口实现里（那是存储细节）。
 *
 * 其余方法（列表、标记已读、删除）确实是「查库 + 拼 DTO」，所以这里就是
 * 编排与投影，没有额外的领域模型。
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly notifications: Notifications) {}

  /** 创建一条通知。 */
  create(
    userId: string,
    dto: NewNotification,
  ): ResultAsync<NotificationItem, DomainFailure> {
    return fromPromise(this.notifications.create(userId, dto), (error) =>
      mapUnknownToDependencyFailure(error, 'Failed to create notification'),
    ).map((row) => this.toListItemDto(row));
  }

  /**
   * 幂等创建：同一作用域只留一条。
   *
   * 这是本模块**唯一有真实规则的写操作**——重复的通知会淹没用户的通知中心。
   * 规则本身（什么算同一作用域）在 `domain/`，执行方式在端口实现。
   */
  createOrReplaceScoped(
    userId: string,
    dto: NewNotification,
    scope: NotificationScope,
  ): ResultAsync<NotificationItem, DomainFailure> {
    return fromPromise(
      this.notifications.createOrReplaceScoped(userId, dto, scope),
      (error) =>
        mapUnknownToDependencyFailure(
          error,
          'Failed to create scoped notification',
        ),
    ).map((row) => this.toListItemDto(row));
  }

  async findAll(
    userId: string,
    options: { page: number; pageSize: number },
  ): Promise<{ items: NotificationItem[]; total: number }> {
    const { items, total } = await this.notifications.list(userId, options);
    return { items: items.map((row) => this.toListItemDto(row)), total };
  }

  /**
   * 读一条通知详情。
   *
   * 不存在或属于别人都是 `NOTIFICATION_NOT_FOUND`——**不区分**，
   * 否则等于告诉调用方「这个 id 存在」。
   */
  findOne(
    userId: string,
    id: string,
  ): ResultAsync<NotificationDetail, DomainFailure> {
    return fromPromise(this.notifications.findById(userId, id), (error) =>
      mapUnknownToDependencyFailure(error, 'Failed to load notification'),
    ).andThen((row) =>
      row != null
        ? okAsync(this.toDetailDto(row))
        : errAsync(this.notificationNotFound()),
    );
  }

  markAsRead(
    userId: string,
    id: string,
  ): ResultAsync<NotificationDetail, DomainFailure> {
    return fromPromise(this.notifications.markRead(userId, id), (error) =>
      mapUnknownToDependencyFailure(error, 'Failed to mark notification read'),
    ).andThen(() => this.findOne(userId, id));
  }

  markAsUnread(
    userId: string,
    id: string,
  ): ResultAsync<NotificationDetail, DomainFailure> {
    return fromPromise(this.notifications.markUnread(userId, id), (error) =>
      mapUnknownToDependencyFailure(
        error,
        'Failed to mark notification unread',
      ),
    ).andThen(() => this.findOne(userId, id));
  }

  markAllAsRead(userId: string): Promise<number> {
    return this.notifications.markAllRead(userId);
  }

  /** 删除一条；不存在或不属于该用户都是 `NOTIFICATION_NOT_FOUND`。 */
  remove(userId: string, id: string): ResultAsync<void, DomainFailure> {
    return fromPromise(this.notifications.remove(userId, id), (error) =>
      mapUnknownToDependencyFailure(error, 'Failed to delete notification'),
    ).andThen((removed) =>
      removed ? okAsync(undefined) : errAsync(this.notificationNotFound()),
    );
  }

  getUnreadCount(userId: string): Promise<number> {
    return this.notifications.unreadCount(userId);
  }

  private toListItemDto(row: NotificationRow): NotificationItem {
    return {
      id: row.id,
      // 仓储层用 `string` 宽的读侧类型（`domain/` 不依赖 `adapters/` 的字面量
      // 联合）；写入时已由 DTO 校验，所以这里收窄是安全的。
      type: row.type,
      title: row.title,
      content: row.content,
      action: row.action ?? null,
      // 响应 schema 把 actionPayload 声明为 `unknown`（历史 JSON 姿态），
      // 所以原始值直接透传。
      actionPayload: row.actionPayload ?? null,
      isRead: row.isRead,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toDetailDto(row: NotificationRow): NotificationDetail {
    return {
      ...this.toListItemDto(row),
      readAt: row.readAt?.toISOString() ?? null,
    };
  }

  private notificationNotFound(): DomainFailure {
    return createDomainFailure({
      kind: 'not_found',
      code: 'NOTIFICATION_NOT_FOUND',
    });
  }
}
