import { describe, expectTypeOf, it } from 'vitest';

import type {
  EventReviewCheckInCoverage,
  EventReviewCoverageSummary,
  EventReviewData,
  EventReviewEvent,
  EventReviewListData,
  EventReviewListQuery,
  EventReviewObservedSource,
  EventReviewSection,
  EventReviewSectionFacts,
  EventReviewSections,
  EventReviewSourceTimestamps,
  EventReviewTodayCheckIn,
} from '../../../application/ports/event-review.js';
import type {
  EventReviewCheckInCoverageDto,
  EventReviewCoverageSummaryDto,
  EventReviewDataDto,
  EventReviewEventDto,
  EventReviewListDataDto,
  EventReviewObservedSourceDto,
  EventReviewSectionDto,
  EventReviewSectionFactsDto,
  EventReviewSectionsDto,
  EventReviewSourceTimestampsDto,
  EventReviewTodayCheckInDto,
} from './event-review-response.js';
import type { EventReviewListQueryDto } from './event-review-list-query.js';

/**
 * The event-review response shapes exist twice on purpose (ADR-0024 D1/D2):
 * `ddd-application-no-infra-or-adapters` forbids `application/` from importing
 * `adapters/`, so the read model declares the shape in
 * `application/ports/event-review.ts` while the HTTP DTO keeps the zod schema
 * that validates and serializes it.
 *
 * This spec pins the two together. **Bidirectional on purpose**: a one-way
 * `satisfies` would only catch "the application shape lost a field". It would
 * miss the more likely drift — "the schema gained a field the read model never
 * fills", which serializes as `undefined` and breaks the generated clients that
 * type these fields as non-nullable.
 *
 * Each sub-shape gets its own assertion so a failure names the layer that
 * drifted instead of reporting one opaque mismatch on the envelope.
 */
describe('event-review response shape mirrors the application port', () => {
  it('mirrors the section facts shape', () => {
    expectTypeOf<EventReviewSectionFactsDto>().toEqualTypeOf<EventReviewSectionFacts>();
  });

  it('mirrors the section shape', () => {
    expectTypeOf<EventReviewSectionDto>().toEqualTypeOf<EventReviewSection>();
  });

  it('mirrors the four-section envelope', () => {
    expectTypeOf<EventReviewSectionsDto>().toEqualTypeOf<EventReviewSections>();
  });

  it('mirrors the event shape', () => {
    expectTypeOf<EventReviewEventDto>().toEqualTypeOf<EventReviewEvent>();
  });

  it('mirrors the today check-in shape', () => {
    expectTypeOf<EventReviewTodayCheckInDto>().toEqualTypeOf<EventReviewTodayCheckIn>();
  });

  it('mirrors the check-in coverage shape', () => {
    expectTypeOf<EventReviewCheckInCoverageDto>().toEqualTypeOf<EventReviewCheckInCoverage>();
  });

  it('mirrors the observed-source shape', () => {
    expectTypeOf<EventReviewObservedSourceDto>().toEqualTypeOf<EventReviewObservedSource>();
  });

  it('mirrors the coverage summary', () => {
    expectTypeOf<EventReviewCoverageSummaryDto>().toEqualTypeOf<EventReviewCoverageSummary>();
  });

  it('mirrors the source timestamps', () => {
    expectTypeOf<EventReviewSourceTimestampsDto>().toEqualTypeOf<EventReviewSourceTimestamps>();
  });

  it('mirrors the review envelope', () => {
    expectTypeOf<EventReviewDataDto>().toEqualTypeOf<EventReviewData>();
  });

  it('mirrors the list payload', () => {
    expectTypeOf<EventReviewListDataDto>().toEqualTypeOf<EventReviewListData>();
  });

  it('mirrors the list query', () => {
    expectTypeOf<EventReviewListQueryDto>().toEqualTypeOf<EventReviewListQuery>();
  });
});
