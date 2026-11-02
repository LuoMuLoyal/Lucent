import type { NotificationItem } from '../commands/notification.js';
import type { NewNotification } from '../../domain/notification/notification.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';

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
    dto: NewNotification,
  ): ResultAsync<NotificationItem, DomainFailure>;

  abstract createOrReplaceScoped(
    userId: string,
    dto: NewNotification,
    scope: NotificationScope,
  ): ResultAsync<NotificationItem, DomainFailure>;
}
