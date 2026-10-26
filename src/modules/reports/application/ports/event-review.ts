/**
 * Event Review read-model shapes owned by the application layer.
 *
 * The read model *produces* these shapes; the HTTP DTO only validates and
 * serializes them. `ddd-application-no-infra-or-adapters` forbids
 * `application/` from importing `adapters/`, so the shapes are declared here.
 *
 * **Drift protection**: `adapters/http/dto/event-review-response.spec.ts`
 * asserts both directions with `expectTypeOf<Dto>().toEqualTypeOf<Shape>()`.
 * One direction only would miss "the DTO grew a field the read model never
 * fills" — the most likely drift, since contract edits start in the schema.
 *
 * These are declared as plain mutable interfaces on purpose: `z.infer` produces
 * mutable object types, so adding `readonly` here would make the mirror
 * assertion fail for a reason that says nothing about the contract. Immutability
 * is a read-model discipline, not part of the wire shape.
 */

import type {
  HealthEventKind,
  HealthEventOutcome,
  HealthEventStatus,
} from '#generated/prisma/client.js';

/** Source kinds an observation can come from. */
export type EventReviewObservedSourceKind =
  | 'manual'
  | 'health_platform'
  | 'reminder_plan'
  | 'derived';

/** Whether a section could be computed from the available data. */
export type EventReviewSectionState = 'available' | 'unknown';

/**
 * Fixed reason codes for unknown sections. `insufficient_coverage` came second:
 * it distinguishes "we looked and the data was too sparse" from "there are no
 * observations at all".
 */
export type EventReviewSectionReasonCode =
  | 'no_observations'
  | 'no_completed_actions'
  | 'insufficient_coverage';

/** Suggested next action for the user after this review. */
export type EventReviewAction =
  | 'check_in'
  | 'end_event'
  | 'clinic_summary'
  | 'export';

/** One structured fact: a stable code plus localizable arguments. */
export interface EventReviewSectionFacts {
  code: string;
  /**
   * Values must be non-null: the generated clients type this map with
   * non-nullable values, so a JSON `null` breaks their deserializer.
   * Producers omit absent keys — see `read_models/event-review/fact-arguments.ts`.
   */
  arguments: Record<string, unknown>;
}

/** One review section. */
export interface EventReviewSection {
  state: EventReviewSectionState;
  reasonCode?: EventReviewSectionReasonCode | undefined;
  /** Structured facts when `state` is `available`; a single object, not a list. */
  facts?: EventReviewSectionFacts | undefined;
}

/** The four fixed review sections. */
export interface EventReviewSections {
  whatHappened: EventReviewSection;
  keyChanges: EventReviewSection;
  completedActions: EventReviewSection;
  nextStep: EventReviewSection;
}

/** The health event the review centers on. */
export interface EventReviewEvent {
  id: string;
  kind: HealthEventKind;
  title: string;
  status: HealthEventStatus;
  startedAt: string;
  endedAt: string | null;
  outcome: HealthEventOutcome | null;
  currentMedicineIds: string[];
}

/** Today's check-in for the reviewed event. */
export interface EventReviewTodayCheckIn {
  date: string;
  outcome: HealthEventOutcome;
  updatedAt: string;
}

/** Coverage of the user's check-ins within the event window. */
export interface EventReviewCheckInCoverage {
  state: 'observed' | 'unknown';
  coverage: 'sufficient' | 'partial' | 'none';
  sources: EventReviewObservedSourceKind[];
  observedCount: number;
  expectedCount: number | null;
  firstCheckInDate: string | null;
  lastCheckInDate: string | null;
  todayCheckIn: EventReviewTodayCheckIn | null;
  windowStart: string;
  windowEnd: string;
}

/** Coverage of one observed data source (daily records, dose logs). */
export interface EventReviewObservedSource {
  state: 'observed' | 'unknown';
  coverage: 'sufficient' | 'partial' | 'none';
  sources: EventReviewObservedSourceKind[];
  observedCount: number;
  expectedCount: number | null;
  windowStart: string;
  windowEnd: string;
}

/** Coverage summary across every source the review reads. */
export interface EventReviewCoverageSummary {
  checkIns: EventReviewCheckInCoverage;
  dailyRecords: EventReviewObservedSource;
  doseLogs: EventReviewObservedSource;
}

/** Last-known timestamp per source, used to explain staleness. */
export interface EventReviewSourceTimestamps {
  checkIns: string | null;
  dailyRecords: string | null;
  doseLogs: string | null;
}

/** The full review envelope. */
export interface EventReviewData {
  event: EventReviewEvent;
  sections: EventReviewSections;
  coverage: EventReviewCoverageSummary;
  sourceTimestamps: EventReviewSourceTimestamps;
  availableActions: EventReviewAction[];
  generatedAt: string;
}

/** Paginated review history. */
export interface EventReviewListData {
  items: EventReviewEvent[];
  total: number;
  nextCursor: string | null;
}

/**
 * Input vocabulary of `GET /reports/reviews`.
 *
 * Explicit `| undefined` on every key: the HTTP layer parses with zod, and
 * `z.infer` of an optional key is `T | undefined`, which
 * `exactOptionalPropertyTypes` distinguishes from a bare optional `T`. Same
 * resolution as `user-settings`' `UpdateUserSettingsCommand`.
 */
export interface EventReviewListQuery {
  status?: HealthEventStatus | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}
