import { z } from 'zod';
import {
  HealthEventKind,
  HealthEventOutcome,
  HealthEventStatus,
} from '#generated/prisma/client.js';

/**
 * Event Review read model response schemas.
 *
 * The review envelope centers on one health event. The four fixed sections
 * each carry `state: available | unknown`; unknown sections expose a fixed
 * reason code and never fabricated copy. Coverage entries reuse the unified
 * observed-metric contract (state/coverage/sources/observedCount/
 * expectedCount/windowStart/windowEnd) without duplicating the aggregation
 * rules of the dashboard or suggestion pipelines.
 *
 * Each schema replaces the former `@ApiProperty` response class of the same
 * name (minus the `Schema` suffix).
 */

export type EventReviewSectionState = 'available' | 'unknown';

/**
 * Fixed reason codes for unknown sections. Task 2 section services extended
 * this union with `insufficient_coverage` without changing the DTO shape.
 */
export type EventReviewSectionReasonCode =
  | 'no_observations'
  | 'no_completed_actions'
  | 'insufficient_coverage';

export type EventReviewAction =
  | 'check_in'
  | 'end_event'
  | 'clinic_summary'
  | 'export';

/** Replaces `EventReviewSectionFactsDto`. */
export const eventReviewSectionFactsSchema = z.object({
  code: z.string().describe('Structured fact code; localized by the client.'),
  arguments: z
    .record(z.string(), z.unknown())
    .describe('Structured fact arguments for the client localizer.'),
});

/** Strongly typed structured section facts of an event review. */
export type EventReviewSectionFactsDto = z.infer<
  typeof eventReviewSectionFactsSchema
>;

/** Replaces `EventReviewSectionDto`. */
export const eventReviewSectionSchema = z.object({
  state: z.enum(['available', 'unknown']),
  reasonCode: z
    .enum(['no_observations', 'no_completed_actions', 'insufficient_coverage'])
    .optional()
    .describe(
      'Fixed reason code when state is unknown: no_observations (window has ' +
        'no observations), no_completed_actions (no confirmed doses or ' +
        'check-ins), insufficient_coverage (observations exist but no trend is ' +
        'computable).',
    ),
  facts: eventReviewSectionFactsSchema
    .optional()
    .describe('Basic facts when state is available.'),
});

/** Strongly typed one review section (whatHappened/keyChanges/…). */
export type EventReviewSectionDto = z.infer<typeof eventReviewSectionSchema>;

/** Replaces `EventReviewSectionsDto`. */
export const eventReviewSectionsSchema = z.object({
  whatHappened: eventReviewSectionSchema,
  keyChanges: eventReviewSectionSchema,
  completedActions: eventReviewSectionSchema,
  nextStep: eventReviewSectionSchema,
});

/** Strongly typed four fixed review sections. */
export type EventReviewSectionsDto = z.infer<typeof eventReviewSectionsSchema>;

/** Replaces `EventReviewEventDto`. */
export const eventReviewEventSchema = z.object({
  id: z.string(),
  kind: z.enum(HealthEventKind),
  title: z.string(),
  status: z.enum(HealthEventStatus),
  startedAt: z.string().describe('Start time in ISO 8601 format.'),
  endedAt: z
    .string()
    .nullable()
    .describe('End time in ISO 8601 format, or null while active.'),
  outcome: z.enum(HealthEventOutcome).nullable(),
  currentMedicineIds: z.array(z.string()),
});

/** Strongly typed health event of an event review. */
export type EventReviewEventDto = z.infer<typeof eventReviewEventSchema>;

/** Replaces `EventReviewTodayCheckInDto`. */
export const eventReviewTodayCheckInSchema = z.object({
  date: z.string().describe('Calendar date in YYYY-MM-DD format.'),
  outcome: z.enum(HealthEventOutcome),
  updatedAt: z.string().describe('Last update time in ISO 8601 format.'),
});

/** Strongly typed today check-in of an event review. */
export type EventReviewTodayCheckInDto = z.infer<
  typeof eventReviewTodayCheckInSchema
>;

/** Replaces `EventReviewCheckInCoverageDto`. */
export const eventReviewCheckInCoverageSchema = z.object({
  state: z.enum(['observed', 'unknown']),
  coverage: z
    .enum(['sufficient', 'partial', 'none'])
    .describe(
      "'none' when no check-ins exist; 'partial' when check-ins exist but " +
        'sufficiency is not yet assessed by the section services.',
    ),
  sources: z.array(
    z.enum(['manual', 'health_platform', 'reminder_plan', 'derived']),
  ),
  observedCount: z.number().describe('Number of user-confirmed check-ins.'),
  expectedCount: z
    .number()
    .nullable()
    .describe('No fixed expectation exists for check-ins.'),
  firstCheckInDate: z
    .string()
    .nullable()
    .describe('First check-in calendar date, or null when none exists.'),
  lastCheckInDate: z
    .string()
    .nullable()
    .describe('Last check-in calendar date, or null when none exists.'),
  todayCheckIn: eventReviewTodayCheckInSchema.nullable(),
  windowStart: z.string().describe('Event window start in ISO 8601 format.'),
  windowEnd: z.string().describe('Event window end in ISO 8601 format.'),
});

/** Strongly typed check-in coverage of an event review. */
export type EventReviewCheckInCoverageDto = z.infer<
  typeof eventReviewCheckInCoverageSchema
>;

/** Replaces `EventReviewObservedSourceDto`. */
export const eventReviewObservedSourceSchema = z.object({
  state: z.enum(['observed', 'unknown']),
  coverage: z
    .enum(['sufficient', 'partial', 'none'])
    .describe(
      "The skeleton emits 'none' or 'partial'; sufficiency assessment lands " +
        'with the section services.',
    ),
  sources: z.array(
    z.enum(['manual', 'health_platform', 'reminder_plan', 'derived']),
  ),
  observedCount: z
    .number()
    .describe('Number of observations in the event window.'),
  expectedCount: z
    .number()
    .nullable()
    .describe('No fixed expectation is defined for this source yet.'),
  windowStart: z.string().describe('Event window start in ISO 8601 format.'),
  windowEnd: z.string().describe('Event window end in ISO 8601 format.'),
});

/** Strongly typed observed-source coverage of an event review. */
export type EventReviewObservedSourceDto = z.infer<
  typeof eventReviewObservedSourceSchema
>;

/** Replaces `EventReviewCoverageSummaryDto`. */
export const eventReviewCoverageSummarySchema = z.object({
  checkIns: eventReviewCheckInCoverageSchema,
  dailyRecords: eventReviewObservedSourceSchema,
  doseLogs: eventReviewObservedSourceSchema,
});

/** Strongly typed coverage summary of an event review. */
export type EventReviewCoverageSummaryDto = z.infer<
  typeof eventReviewCoverageSummarySchema
>;

/** Replaces `EventReviewSourceTimestampsDto`. */
export const eventReviewSourceTimestampsSchema = z.object({
  checkIns: z
    .string()
    .nullable()
    .describe('Last check-in calendar date (YYYY-MM-DD), or null.'),
  dailyRecords: z
    .string()
    .nullable()
    .describe(
      'Latest daily-record creation time in the event window (ISO 8601), ' +
        'or null.',
    ),
  doseLogs: z
    .string()
    .nullable()
    .describe(
      'Latest dose-log scheduled time in the event window (ISO 8601), or null.',
    ),
});

/** Strongly typed source timestamps of an event review. */
export type EventReviewSourceTimestampsDto = z.infer<
  typeof eventReviewSourceTimestampsSchema
>;

/**
 * The shared event-review data shape. Replaces the former `@ApiProperty`
 * response class `EventReviewDataDto`.
 */
export const eventReviewDataSchema = z.object({
  event: eventReviewEventSchema,
  sections: eventReviewSectionsSchema,
  coverage: eventReviewCoverageSummarySchema,
  sourceTimestamps: eventReviewSourceTimestampsSchema,
  availableActions: z
    .array(z.enum(['check_in', 'end_event', 'clinic_summary', 'export']))
    .describe(
      'Actions the user can take from this review, mapped by the client.',
    ),
  generatedAt: z.string().describe('Review assembly time in ISO 8601 format.'),
});

/** Strongly typed event review data payload. */
export type EventReviewDataDto = z.infer<typeof eventReviewDataSchema>;

/**
 * Replaces `EventReviewListDataDto` — the paginated history payload.
 */
export const eventReviewListDataSchema = z.object({
  items: z.array(eventReviewEventSchema),
  total: z.number().describe('Total matching events for the filter.'),
  nextCursor: z
    .string()
    .nullable()
    .describe(
      'Cursor for the next page (last item startedAt in ISO 8601), or null ' +
        'on the last page.',
    ),
});

/** Strongly typed event-review history list payload. */
export type EventReviewListDataDto = z.infer<typeof eventReviewListDataSchema>;

/**
 * Response schema of `GET /reports/reviews/:eventId` — wire-identical to
 * {@link eventReviewDataSchema}. Replaces the former response class
 * `EventReviewResponseDto` (which extended `EventReviewDataDto` without
 * adding fields).
 */
export const eventReviewResponseSchema = eventReviewDataSchema;

/** Strongly typed single-event review response body. */
export type EventReviewResponseDto = z.infer<typeof eventReviewResponseSchema>;

/**
 * Response schema of `GET /reports/reviews/current` — the event review data,
 * or `null` when the user has no review. Replaces the former response class
 * `EventReviewNullableResponseDto` (which extended `EventReviewDataDto`
 * without adding fields).
 */
export const eventReviewNullableResponseSchema =
  eventReviewDataSchema.nullable();

/** Strongly typed nullable current-review response body. */
export type EventReviewNullableResponseDto = z.infer<
  typeof eventReviewNullableResponseSchema
>;

/**
 * Response schema of `GET /reports/reviews` — wire-identical to
 * {@link eventReviewListDataSchema}. Replaces the former response class
 * `EventReviewListResponseDto` (which extended `EventReviewListDataDto`
 * without adding fields).
 */
export const eventReviewListResponseSchema = eventReviewListDataSchema;

/** Strongly typed event-review list response body. */
export type EventReviewListResponseDto = z.infer<
  typeof eventReviewListResponseSchema
>;
