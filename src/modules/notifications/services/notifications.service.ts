import { Injectable } from '@nestjs/common';
import type { Prisma } from '#generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { now } from '../../../common/utils/date-time.utils';
import {
  type CreateNotificationDto,
  type NotificationListItemDto,
  type NotificationDetailDto,
} from '../dto';

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

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    dto: CreateNotificationDto,
  ): Promise<NotificationListItemDto> {
    const created = await this.prisma.userNotification.create({
      data: {
        userId,
        type: dto.type,
        title: dto.title,
        content: dto.content,
        action: dto.action ?? null,
        actionPayload: (dto.actionPayload ?? null) as Prisma.InputJsonValue,
      },
      select: notificationSelect,
    });

    return this.toListItemDto(created);
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

  async findOne(
    userId: string,
    id: string,
  ): Promise<NotificationDetailDto | null> {
    const row = await this.prisma.userNotification.findFirst({
      where: { id, userId },
      select: notificationSelect,
    });

    return row ? this.toDetailDto(row) : null;
  }

  async markAsRead(
    userId: string,
    id: string,
  ): Promise<NotificationDetailDto | null> {
    const row = await this.prisma.userNotification.updateMany({
      where: { id, userId, isRead: false },
      data: { isRead: true, readAt: now() },
    });

    if (row.count === 0) {
      return this.findOne(userId, id);
    }

    return this.findOne(userId, id);
  }

  async markAsUnread(
    userId: string,
    id: string,
  ): Promise<NotificationDetailDto | null> {
    await this.prisma.userNotification.updateMany({
      where: { id, userId },
      data: { isRead: false, readAt: null },
    });

    return this.findOne(userId, id);
  }

  async markAllAsRead(userId: string): Promise<number> {
    const result = await this.prisma.userNotification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: now() },
    });

    return result.count;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.userNotification.deleteMany({
      where: { id, userId },
    });

    return result.count > 0;
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
      actionPayload:
        (row.actionPayload as Record<string, unknown> | null) ?? null,
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
}
