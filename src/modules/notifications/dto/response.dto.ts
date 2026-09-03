import { z } from 'zod';
import { type UserNotificationType } from '#generated/prisma/client.js';

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

// ── Response schemas (Standard Schema / zod) ────────────────────────────────
//
// Response-side counterpart of the app-info pilot: these schemas describe the
// outbound wire shapes, are consumed by `StandardSchemaSerializerInterceptor`
// via `@SerializeOptions({ schema })`, and are registered in
// `response-schema.registry` so the OpenAPI export keeps the former DTO class
// names as named components (Luminous model names stay stable). Unlike request
// schemas they carry no `.strict()` / `.default()`: outbound parsing must
// tolerate whatever the service layer produces.

/**
 * Wire shape of a single notification list entry (`GET /notifications` items
 * and the `POST /notifications` creation result).
 */
export const notificationListItemSchema = z.object({
  id: z.string().describe('Unique notification identifier.'),
  type: z.enum(USER_NOTIFICATION_TYPES),
  title: z.string().describe('Notification title.'),
  content: z.string().describe('Notification content body.'),
  action: z
    .string()
    .nullable()
    .describe('Action route target for the frontend.'),
  // Legacy posture: the payload is stored/echoed as-is (may be any JSON), so
  // outbound parsing stays permissive instead of enforcing a map shape.
  actionPayload: z
    .unknown()
    .nullable()
    .describe('Extra payload for the action.'),
  isRead: z.boolean().describe('Whether the notification has been read.'),
  createdAt: z
    .string()
    .describe('ISO-8601 timestamp when the notification was created.'),
});

/** Strongly typed notification list entry. */
export type NotificationListItemDto = z.infer<
  typeof notificationListItemSchema
>;

/**
 * Wire shape of a notification detail (`GET /notifications/:id`, the
 * read/unread PATCH responses): a list entry plus the read timestamp.
 */
export const notificationDetailSchema = notificationListItemSchema.extend({
  readAt: z
    .string()
    .nullable()
    .describe('ISO-8601 timestamp when the notification was read.'),
});

/** Strongly typed notification detail. */
export type NotificationDetailDto = z.infer<typeof notificationDetailSchema>;

/** Wire shape of the paginated `GET /notifications` response. */
export const notificationListSchema = z.object({
  items: z.array(notificationListItemSchema),
  total: z.number().describe('Total count of notifications for the user.'),
});

/** Strongly typed paginated notification list. */
export type NotificationListDataDto = z.infer<typeof notificationListSchema>;

/** Backwards-compatible alias kept for the former response DTO name. */
export type NotificationListResponseDto = NotificationListDataDto;

/** Backwards-compatible alias kept for the former response DTO name. */
export type NotificationDetailResponseDto = NotificationDetailDto;

/** Wire shape of the unread-count responses (`GET /unread-count`, mark-all-read). */
export const unreadCountSchema = z.object({
  count: z.number().describe('Number of unread notifications.'),
});

/** Strongly typed unread count resource. */
export type UnreadCountDataDto = z.infer<typeof unreadCountSchema>;

/** Backwards-compatible alias kept for the former response DTO name. */
export type UnreadCountResponseDto = UnreadCountDataDto;

/**
 * Standard Schema (zod 4) for `POST /notifications` — mirrors the former
 * class-validator body: `type` restricted to user-creatable types, `action`
 * nullable, `actionPayload` unconstrained (legacy posture, no type check).
 * Unknown keys are rejected (`.strict()`, parity with the global
 * `forbidNonWhitelisted`).
 */
export const createNotificationSchema = z
  .object({
    type: z
      .enum(
        USER_CREATABLE_NOTIFICATION_TYPES as unknown as [
          UserNotificationType,
          ...UserNotificationType[],
        ],
      )
      .describe(
        'Notification type. System-level types (e.g. system_announcement) are not allowed for user-created notifications.',
      ),
    title: z.string().describe('Notification title.'),
    content: z.string().describe('Notification content body.'),
    action: z
      .string()
      .nullish()
      .describe('Action route target for the frontend.'),
    actionPayload: z
      .unknown()
      .nullish()
      .describe('Extra payload for the action.'),
  })
  .strict();

/** Strongly typed body of `POST /notifications`. */
export type CreateNotificationDto = z.infer<typeof createNotificationSchema>;
