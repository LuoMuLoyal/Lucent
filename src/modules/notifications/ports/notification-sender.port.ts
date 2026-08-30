import type {
  CreateNotificationDto,
  NotificationListItemDto,
} from '../dto/response.dto';
import type { DomainFailure, ResultAsync } from '../../../common/result';

/**
 * Scope metadata for idempotent notification creation.  When a notification
 * with the same `{userId, type, scopeKey}` already exists it is updated
 * instead of creating a duplicate.
 */
export interface NotificationScope {
  source: string;
  date: string;
  scopeKey?: string;
}

/**
 * Write-only port for sending notifications.  Consumed by modules that need
 * to create notifications (today-suggestion, today-analysis, auth,
 * medicine-reminders, data-export, notification-preferences) without
 * depending on the full NotificationsService API.
 *
 * Registered in NotificationsModule via:
 * `{ provide: INotificationSender, useExisting: NotificationsService }`
 */
export abstract class INotificationSender {
  abstract create(
    userId: string,
    dto: CreateNotificationDto,
  ): ResultAsync<NotificationListItemDto, DomainFailure>;

  abstract createOrReplaceScoped(
    userId: string,
    dto: CreateNotificationDto,
    scope: NotificationScope,
  ): ResultAsync<NotificationListItemDto, DomainFailure>;
}
