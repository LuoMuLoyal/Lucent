import { z } from 'zod';

/**
 * 本地通知投递回执请求体。
 *
 * 客户端在本地通知实际展示后上报（幂等）：服务端按用户 profile 时区将
 * scheduledDate + scheduledTime 换算为 UTC 并截断到分钟，作为投递行的
 * `scheduledFor`，写入 channel='local' 的审计行。
 *
 * Replaces the former class-validator DTO (`@Matches` regexes kept as
 * `.regex(...)` with the same messages; `.strict()` preserves the global
 * `forbidNonWhitelisted` rejection of unknown body keys).
 */
export const reminderDeliveryReceiptSchema = z
  .object({
    reminderId: z.string().min(1).describe('Linked medicine reminder id.'),
    scheduledDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, {
        message: 'scheduledDate must match YYYY-MM-DD',
      })
      .describe('Local scheduled date in YYYY-MM-DD format.'),
    scheduledTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
        message: 'scheduledTime must match HH:mm (24h)',
      })
      .describe('Local scheduled time in HH:mm format (24h).'),
  })
  .strict();

/** Strongly typed body of `POST /reminder-deliveries/receipts`. */
export type ReminderDeliveryReceiptDto = z.infer<
  typeof reminderDeliveryReceiptSchema
>;
