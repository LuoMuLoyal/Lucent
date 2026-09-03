import { z } from 'zod';

/**
 * zod 4 Standard Schemas for the reminder-delivery response bodies
 * (`GET /reminder-deliveries`, `POST /reminder-deliveries/receipts`,
 * `PUT /reminder-deliveries/local-capability`).
 *
 * Migrated from the former `@ApiProperty` response classes (class names kept
 * as `z.infer` type aliases; descriptions preserved via `.describe`):
 * - nullable columns → `.nullable()` (key always present, value may be null);
 * - `channel`/`status` are free-form strings persisted from shared constants;
 * - `state` mirrors the request-side `localCapabilityStateSchema` enum values;
 * - timestamps stay plain strings (no `format` added) so the client contract
 *   is unchanged.
 *
 * No `.strict()` / `.default()` — outbound validation must accept the wire
 * shapes produced by the mapper / capability service (every key present).
 */

export const reminderDeliveryItemSchema = z.object({
  id: z.string().describe('Delivery log id.'),
  reminderId: z.string().nullable().describe('Linked medicine reminder id.'),
  deviceId: z.string().nullable().describe('Target device id.'),
  channel: z.string().describe('Delivery channel.'),
  status: z.string().describe('Delivery status.'),
  scheduledFor: z.string().describe('Scheduled delivery time (ISO 8601).'),
  deliveredAt: z
    .string()
    .nullable()
    .describe('Actual delivery time (ISO 8601).'),
  errorMessage: z.string().nullable().describe('Failure reason, if any.'),
  createdAt: z.string().describe('Created at (ISO 8601).'),
});

export const reminderDeliveryListDataSchema = z.object({
  items: z.array(reminderDeliveryItemSchema).describe('Delivery audit rows.'),
});

/** List body of `GET /reminder-deliveries`. */
export const reminderDeliveryListResponseSchema =
  reminderDeliveryListDataSchema;

export const reminderDeliveryReceiptDataSchema = z.object({
  item: reminderDeliveryItemSchema.describe('The recorded delivery row.'),
});

/** 本地通知回执响应体：`{ item }`。 */
export const reminderDeliveryReceiptResponseSchema =
  reminderDeliveryReceiptDataSchema;

export const localCapabilityDataSchema = z.object({
  state: z
    .enum(['active', 'unavailable', 'disabled'])
    .describe('Persisted local scheduling capability state.'),
});

/** 本地调度能力上报响应体：`{ state }`。 */
export const localCapabilityResponseSchema = localCapabilityDataSchema;

/** Strongly typed delivery audit row. */
export type ReminderDeliveryItemDto = z.infer<
  typeof reminderDeliveryItemSchema
>;

/** Strongly typed delivery list body. */
export type ReminderDeliveryListResponseDto = z.infer<
  typeof reminderDeliveryListResponseSchema
>;

/** Strongly typed receipt response body (`{ item }`). */
export type ReminderDeliveryReceiptResponseDto = z.infer<
  typeof reminderDeliveryReceiptResponseSchema
>;

/** Strongly typed capability response body (`{ state }`). */
export type LocalCapabilityResponseDto = z.infer<
  typeof localCapabilityResponseSchema
>;
