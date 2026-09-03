import { Injectable } from '@nestjs/common';
import type { Prisma } from '#generated/prisma/client.js';
import { PrismaService } from '../../../prisma/index.js';
import {
  fromPrismaResult,
  now,
  toInputJsonValue,
} from '../../../common/index.js';
import {
  createDomainFailure,
  errAsync,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result/index.js';
import type {
  CreateNotificationDto,
  NotificationListItemDto,
  NotificationDetailDto,
} from '../dto/response.dto.js';

const notificationSelect = {
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

type UserNotificationRow = Prisma.UserNotificationGetPayload<{
  select: typeof notificationSelect;
}>;

interface NotificationScope {
  source: string;
  date: string;
  scopeKey?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(
    userId: string,
    dto: CreateNotificationDto,
  ): ResultAsync<NotificationListItemDto, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userNotification.create({
        data: {
          userId,
          type: dto.type,
          title: dto.title,
          content: dto.content,
          action: dto.action ?? null,
          actionPayload: toInputJsonValue(dto.actionPayload ?? null),
        },
        select: notificationSelect,
      }),
    ).map((created) => this.toListItemDto(created));
  }

  createOrReplaceScoped(
    userId: string,
    dto: CreateNotificationDto,
    scope: NotificationScope,
  ): ResultAsync<NotificationListItemDto, DomainFailure> {
    const transaction = this.prisma.$transaction<UserNotificationRow>(
      async (tx) => {
        if (scope.scopeKey != null) {
          return tx.userNotification.upsert({
            where: {
              userId_type_scopeKey: {
                userId,
                type: dto.type,
                scopeKey: scope.scopeKey,
              },
            },
            update: {
              title: dto.title,
              content: dto.content,
              action: dto.action ?? null,
              actionPayload: toInputJsonValue(dto.actionPayload ?? null),
            },
            create: {
              userId,
              type: dto.type,
              scopeKey: scope.scopeKey,
              title: dto.title,
              content: dto.content,
              action: dto.action ?? null,
              actionPayload: toInputJsonValue(dto.actionPayload ?? null),
            },
            select: notificationSelect,
          });
        }

        const existing = await tx.userNotification.findMany({
          where: {
            userId,
            type: dto.type,
          },
          select: notificationSelect,
          orderBy: { createdAt: 'desc' },
          take: 50,
        });

        const duplicateIds = existing
          .filter((row) => this.matchesScope(row.actionPayload, scope))
          .map((row) => row.id)
          .slice(0, 50);

        if (duplicateIds.length > 0) {
          await tx.userNotification.deleteMany({
            where: {
              userId,
              id: {
                in: duplicateIds,
              },
            },
          });
        }

        return tx.userNotification.create({
          data: {
            userId,
            type: dto.type,
            title: dto.title,
            content: dto.content,
            action: dto.action ?? null,
            actionPayload: toInputJsonValue(dto.actionPayload ?? null),
          },
          select: notificationSelect,
        });
      },
    );

    // Known Prisma request errors (P2002/P2025) inside the transaction map to
    // DomainFailure; unknown DB/connection errors rethrow.
    return fromPrismaResult(transaction).map((created) =>
      this.toListItemDto(created),
    );
  }

  async findAll(
    userId: string,
    options: { page: number; pageSize: number },
  ): Promise<{ items: NotificationListItemDto[]; total: number }> {
    const [items, total] = await Promise.all([
      this.prisma.userNotification.findMany({
        where: { userId },
        select: notificationSelect,
        orderBy: { createdAt: 'desc' },
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
      }),
      this.prisma.userNotification.count({ where: { userId } }),
    ]);

    return {
      items: items.map((row) => this.toListItemDto(row)),
      total,
    };
  }

  /**
   * Returns the notification detail. A missing (or other-user) notification
   * is `NOTIFICATION_NOT_FOUND` — the controller folds it at the HTTP
   * boundary into a 404 Problem Details response.
   */
  findOne(
    userId: string,
    id: string,
  ): ResultAsync<NotificationDetailDto, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userNotification.findFirst({
        where: { id, userId },
        select: notificationSelect,
      }),
    ).andThen((row) =>
      row != null
        ? okAsync(this.toDetailDto(row))
        : errAsync(this.notificationNotFound()),
    );
  }

  markAsRead(
    userId: string,
    id: string,
  ): ResultAsync<NotificationDetailDto, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userNotification.updateMany({
        where: { id, userId, isRead: false },
        data: { isRead: true, readAt: now() },
      }),
    ).andThen(() => this.findOne(userId, id));
  }

  markAsUnread(
    userId: string,
    id: string,
  ): ResultAsync<NotificationDetailDto, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userNotification.updateMany({
        where: { id, userId },
        data: { isRead: false, readAt: null },
      }),
    ).andThen(() => this.findOne(userId, id));
  }

  async markAllAsRead(userId: string): Promise<number> {
    const result = await this.prisma.userNotification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: now() },
    });

    return result.count;
  }

  /**
   * Deletes a notification. A missing (or other-user) notification is
   * `NOTIFICATION_NOT_FOUND` so the DELETE endpoint stays 404-consistent.
   */
  remove(userId: string, id: string): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userNotification.deleteMany({
        where: { id, userId },
      }),
    ).andThen((result) =>
      result.count > 0
        ? okAsync(undefined)
        : errAsync(this.notificationNotFound()),
    );
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.userNotification.count({
      where: { userId, isRead: false },
    });
  }

  private toListItemDto(row: UserNotificationRow): NotificationListItemDto {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      content: row.content,
      action: row.action ?? null,
      // The response schema types actionPayload as `unknown` (legacy JSON
      // posture), so the raw Prisma JSON value maps through as-is.
      actionPayload: row.actionPayload ?? null,
      isRead: row.isRead,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toDetailDto(row: UserNotificationRow): NotificationDetailDto {
    const item = this.toListItemDto(row);
    return Object.assign({}, item, {
      readAt: row.readAt?.toISOString() ?? null,
    });
  }

  private notificationNotFound(): DomainFailure {
    return createDomainFailure({
      kind: 'not_found',
      code: 'NOTIFICATION_NOT_FOUND',
    });
  }

  private matchesScope(
    payload: Prisma.JsonValue | null,
    scope: NotificationScope,
  ): boolean {
    if (payload == null) {
      return false;
    }

    if (Array.isArray(payload)) {
      return payload.some(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          !Array.isArray(item) &&
          typeof item['source'] === 'string' &&
          typeof item['date'] === 'string' &&
          item['source'] === scope.source &&
          item['date'] === scope.date,
      );
    }

    if (typeof payload !== 'object') {
      return false;
    }

    return (
      typeof payload['source'] === 'string' &&
      typeof payload['date'] === 'string' &&
      payload['source'] === scope.source &&
      payload['date'] === scope.date
    );
  }
}
