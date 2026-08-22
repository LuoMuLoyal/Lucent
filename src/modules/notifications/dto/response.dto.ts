import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { type UserNotificationType } from '#generated/prisma/client';

export const USER_NOTIFICATION_TYPES = [
  'ai_today_summary',
  'ai_weekly_insight',
  'ai_proactive_suggestion',
  'medicine_missed_dose',
  'password_changed',
  'report_generated',
  'medicine_reminder',
  'system_announcement',
  'oauth_login',
  'identity_linked',
] as const;

/**
 * Notification types that a regular user is allowed to create via the
 * public POST /notifications endpoint.  System-level types such as
 * `system_announcement`, `oauth_login`, and `identity_linked` are excluded —
 * only internal services should create those.
 */
const SYSTEM_ONLY_NOTIFICATION_TYPES = new Set([
  'system_announcement',
  'oauth_login',
  'identity_linked',
]);

export const USER_CREATABLE_NOTIFICATION_TYPES = USER_NOTIFICATION_TYPES.filter(
  (t) => !SYSTEM_ONLY_NOTIFICATION_TYPES.has(t),
) as unknown as readonly UserNotificationType[];

export class NotificationListItemDto {
  @ApiProperty({ description: 'Unique notification identifier.' })
  id!: string;

  @ApiProperty({
    enum: USER_NOTIFICATION_TYPES,
    enumName: 'UserNotificationType',
  })
  type!: UserNotificationType;

  @ApiProperty({ description: 'Notification title.' })
  title!: string;

  @ApiProperty({ description: 'Notification content body.' })
  content!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Action route target for the frontend.',
  })
  action!: string | null;

  @ApiPropertyOptional({
    type: Object,
    nullable: true,
    description: 'Extra payload for the action.',
  })
  actionPayload!: Record<string, unknown> | null;

  @ApiProperty({ description: 'Whether the notification has been read.' })
  isRead!: boolean;

  @ApiProperty({
    description: 'ISO-8601 timestamp when the notification was created.',
  })
  createdAt!: string;
}

export class NotificationDetailDto extends NotificationListItemDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'ISO-8601 timestamp when the notification was read.',
  })
  readAt!: string | null;
}

export class NotificationListDataDto {
  @ApiProperty({ type: () => [NotificationListItemDto] })
  items!: NotificationListItemDto[];

  @ApiProperty({ description: 'Total count of notifications for the user.' })
  total!: number;
}

export class NotificationListResponseDto extends NotificationListDataDto {}

export class NotificationDetailResponseDto extends NotificationDetailDto {}

export class UnreadCountDataDto {
  @ApiProperty({ description: 'Number of unread notifications.', example: 3 })
  count!: number;
}

export class UnreadCountResponseDto extends UnreadCountDataDto {}

export class CreateNotificationDto {
  @ApiProperty({
    enum: USER_CREATABLE_NOTIFICATION_TYPES,
    enumName: 'UserNotificationType',
    description:
      'Notification type. System-level types (e.g. system_announcement) are not allowed for user-created notifications.',
  })
  @IsIn(USER_CREATABLE_NOTIFICATION_TYPES)
  type!: UserNotificationType;

  @ApiProperty({ description: 'Notification title.' })
  @IsString()
  title!: string;

  @ApiProperty({ description: 'Notification content body.' })
  @IsString()
  content!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Action route target for the frontend.',
  })
  @IsOptional()
  @IsString()
  action?: string | null;

  @ApiPropertyOptional({
    type: Object,
    nullable: true,
    description: 'Extra payload for the action.',
  })
  @IsOptional()
  actionPayload?: Record<string, unknown> | null;
}
