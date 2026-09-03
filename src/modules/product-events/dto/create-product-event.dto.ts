import {
  HealthEventStatus,
  ProductEventName,
  ProductEventResult,
  ProductEventSurface,
  UserDevicePlatform,
} from '#generated/prisma/client.js';
import { isoDateOrDatetimeSchema as isoDateOrOffsetDatetimeSchema } from '../../../common/validators/iso-datetime.schema.js';
import { z } from 'zod';

/**
 * Max events per batch request. Bounded to keep requests small and to prevent
 * amplification; the client posts batches (plan: 批量上报有条数限制).
 */
export const MAX_PRODUCT_EVENTS_PER_REQUEST = 50;

/**
 * Max allowed skew of `occurredAt` into the future (24h). Keeps raw events
 * from being posted with far-future timestamps, which would never match the
 * 90-day retention cleanup (a hard privacy guarantee). Enforced in
 * `ProductEventsService` (typed 400), consistent with the repo's service-side
 * date-boundary validation convention.
 */
export const MAX_PRODUCT_EVENT_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * ISO 8601 date (YYYY-MM-DD) or datetime with a UTC offset (Z or ±HH:MM) —
 * the shapes the previous `@IsDateString` (validator loose ISO 8601)
 * accepted for the tested contract. Datetimes without an offset are rejected
 * (no instant semantics). Implemented as a refined string so the OpenAPI
 * conversion stays a plain `string` (an `z.iso.*` union would break the
 * client generator). See `isoDateOrDatetimeSchema` import above.
 */

/**
 * Standard Schema (zod 4) for one privacy-minimal product event.
 *
 * Replaces the former class-validator DTO:
 * - `@IsEnum(E)` → `z.enum(E)` (zod v4 merged enum API, accepts the Prisma
 *   const-object enums directly);
 * - `@IsString`/`@MaxLength` → `z.string().min/max`; `IsNotEmpty` → `.min(1)`
 *   (rejects the empty string like the old decorator);
 * - `@IsOptional` + `@IsDateString` → `z.iso.date().or(z.iso.datetime(...))`;
 * - `.strict()` keeps the global `forbidNonWhitelisted` posture (unknown keys
 *   are rejected at the pipe): in particular a client-supplied `userId`, free
 *   text, or a metadata JSON object. `userId` always comes from the session,
 *   never the body.
 */
export const createProductEventSchema = z
  .object({
    name: z
      .enum(ProductEventName)
      .describe('Fixed product event name — enums only, no free text.'),
    surface: z
      .enum(ProductEventSurface)
      .describe(
        "In-app surface where the event occurred; 'system' marks server-initiated events.",
      ),
    result: z
      .enum(ProductEventResult)
      .describe(
        'Health-event lifecycle events report the outcome semantics (improved/unchanged/worsened), all other events report success/failure.',
      ),
    eventStatus: z
      .enum(HealthEventStatus)
      .describe(
        'Lifecycle status — only health_event_started (active) / health_event_ended (ended) report it; other events omit it.',
      )
      .optional(),
    suggestionRuleCode: z
      .string()
      .max(64)
      .describe(
        'Known server-side suggestion rule code (allowlisted, no free strings); unknown codes are rejected with 400.',
      )
      .optional(),
    appVersion: z
      .string()
      .min(1)
      .max(32)
      .describe('Client app version, e.g. 1.2.0.'),
    platform: z.enum(UserDevicePlatform).describe('Client platform.'),
    occurredAt: isoDateOrOffsetDatetimeSchema().describe(
      'Event time (ISO 8601). Retention scans this field (90 days).',
    ),
    clientEventId: z
      .string()
      .min(1)
      .max(64)
      .describe(
        'Client-generated id enabling retry idempotency — unique per user, so retried batches never double-insert.',
      ),
  })
  .strict();

/** Strongly typed body of one product event in a batch. */
export type CreateProductEventDto = z.infer<typeof createProductEventSchema>;

/**
 * Standard Schema (zod 4) for a batch of product events — size-limited to
 * MAX_PRODUCT_EVENTS_PER_REQUEST. `.strict()` preserves the global
 * `forbidNonWhitelisted` rejection of undeclared top-level body keys.
 */
export const createProductEventBatchSchema = z
  .object({
    events: z
      .array(createProductEventSchema)
      .min(1)
      .max(MAX_PRODUCT_EVENTS_PER_REQUEST)
      .describe(
        `1..${String(MAX_PRODUCT_EVENTS_PER_REQUEST)} events per request.`,
      ),
  })
  .strict();

/** Strongly typed body of `POST /product-events`. */
export type CreateProductEventBatchDto = z.infer<
  typeof createProductEventBatchSchema
>;
