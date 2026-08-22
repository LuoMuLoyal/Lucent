import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  HealthEventKind,
  HealthEventOutcome,
  HealthEventStatus,
} from '#generated/prisma/client';
import type {
  ObservedMetricCoverage,
  ObservedMetricSource,
  ObservedMetricState,
} from '../../../common';

/**
 * Event Review read model DTOs.
 *
 * The review envelope centers on one health event. The four fixed sections
 * each carry `state: available | unknown`; unknown sections expose a fixed
 * reason code and never fabricated copy. Coverage entries reuse the unified
 * observed-metric contract (state/coverage/sources/observedCount/
 * expectedCount/windowStart/windowEnd) without duplicating the aggregation
 * rules of the dashboard or suggestion pipelines.
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

export class EventReviewSectionFactsDto {
  @ApiProperty({
    description: 'Structured fact code; localized by the client.',
  })
  code!: string;

  @ApiProperty({
    type: Object,
    description: 'Structured fact arguments for the client localizer.',
  })
  arguments!: Record<string, unknown>;
}

export class EventReviewSectionDto {
  @ApiProperty({ enum: ['available', 'unknown'] })
  state!: EventReviewSectionState;

  @ApiPropertyOptional({
    enum: ['no_observations', 'no_completed_actions', 'insufficient_coverage'],
    type: String,
    description:
      'Fixed reason code when state is unknown: no_observations (window has ' +
      'no observations), no_completed_actions (no confirmed doses or ' +
      'check-ins), insufficient_coverage (observations exist but no trend is ' +
      'computable).',
  })
  reasonCode?: EventReviewSectionReasonCode;

  @ApiPropertyOptional({
    type: () => EventReviewSectionFactsDto,
    description: 'Basic facts when state is available.',
  })
  facts?: EventReviewSectionFactsDto;
}

export class EventReviewSectionsDto {
  @ApiProperty({ type: () => EventReviewSectionDto })
  whatHappened!: EventReviewSectionDto;

  @ApiProperty({ type: () => EventReviewSectionDto })
  keyChanges!: EventReviewSectionDto;

  @ApiProperty({ type: () => EventReviewSectionDto })
  completedActions!: EventReviewSectionDto;

  @ApiProperty({ type: () => EventReviewSectionDto })
  nextStep!: EventReviewSectionDto;
}

export class EventReviewEventDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: HealthEventKind, enumName: 'HealthEventKind' })
  kind!: HealthEventKind;

  @ApiProperty({ maxLength: 80 })
  title!: string;

  @ApiProperty({ enum: HealthEventStatus, enumName: 'HealthEventStatus' })
  status!: HealthEventStatus;

  @ApiProperty({ description: 'Start time in ISO 8601 format.' })
  startedAt!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'End time in ISO 8601 format, or null while active.',
  })
  endedAt!: string | null;

  @ApiProperty({
    enum: HealthEventOutcome,
    enumName: 'HealthEventOutcome',
    nullable: true,
  })
  outcome!: HealthEventOutcome | null;

  @ApiProperty({ type: String, isArray: true })
  currentMedicineIds!: string[];
}

export class EventReviewTodayCheckInDto {
  @ApiProperty({ description: 'Calendar date in YYYY-MM-DD format.' })
  date!: string;

  @ApiProperty({ enum: HealthEventOutcome, enumName: 'HealthEventOutcome' })
  outcome!: HealthEventOutcome;

  @ApiProperty({ description: 'Last update time in ISO 8601 format.' })
  updatedAt!: string;
}

export class EventReviewCheckInCoverageDto {
  @ApiProperty({ enum: ['observed', 'unknown'] })
  state!: ObservedMetricState;

  @ApiProperty({
    enum: ['sufficient', 'partial', 'none'],
    description:
      "'none' when no check-ins exist; 'partial' when check-ins exist but " +
      'sufficiency is not yet assessed by the section services.',
  })
  coverage!: ObservedMetricCoverage;

  @ApiProperty({
    enum: ['manual', 'health_platform', 'reminder_plan', 'derived'],
    isArray: true,
  })
  sources!: ObservedMetricSource[];

  @ApiProperty({ description: 'Number of user-confirmed check-ins.' })
  observedCount!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'No fixed expectation exists for check-ins.',
  })
  expectedCount!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'First check-in calendar date, or null when none exists.',
  })
  firstCheckInDate!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Last check-in calendar date, or null when none exists.',
  })
  lastCheckInDate!: string | null;

  @ApiProperty({ type: () => EventReviewTodayCheckInDto, nullable: true })
  todayCheckIn!: EventReviewTodayCheckInDto | null;

  @ApiProperty({ description: 'Event window start in ISO 8601 format.' })
  windowStart!: string;

  @ApiProperty({ description: 'Event window end in ISO 8601 format.' })
  windowEnd!: string;
}

export class EventReviewObservedSourceDto {
  @ApiProperty({ enum: ['observed', 'unknown'] })
  state!: ObservedMetricState;

  @ApiProperty({
    enum: ['sufficient', 'partial', 'none'],
    description:
      "The skeleton emits 'none' or 'partial'; sufficiency assessment lands " +
      'with the section services.',
  })
  coverage!: ObservedMetricCoverage;

  @ApiProperty({
    enum: ['manual', 'health_platform', 'reminder_plan', 'derived'],
    isArray: true,
  })
  sources!: ObservedMetricSource[];

  @ApiProperty({ description: 'Number of observations in the event window.' })
  observedCount!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'No fixed expectation is defined for this source yet.',
  })
  expectedCount!: number | null;

  @ApiProperty({ description: 'Event window start in ISO 8601 format.' })
  windowStart!: string;

  @ApiProperty({ description: 'Event window end in ISO 8601 format.' })
  windowEnd!: string;
}

export class EventReviewCoverageSummaryDto {
  @ApiProperty({ type: () => EventReviewCheckInCoverageDto })
  checkIns!: EventReviewCheckInCoverageDto;

  @ApiProperty({ type: () => EventReviewObservedSourceDto })
  dailyRecords!: EventReviewObservedSourceDto;

  @ApiProperty({ type: () => EventReviewObservedSourceDto })
  doseLogs!: EventReviewObservedSourceDto;
}

export class EventReviewSourceTimestampsDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Last check-in calendar date (YYYY-MM-DD), or null.',
  })
  checkIns!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Latest daily-record creation time in the event window (ISO 8601), ' +
      'or null.',
  })
  dailyRecords!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Latest dose-log scheduled time in the event window (ISO 8601), or null.',
  })
  doseLogs!: string | null;
}

export class EventReviewDataDto {
  @ApiProperty({ type: () => EventReviewEventDto })
  event!: EventReviewEventDto;

  @ApiProperty({ type: () => EventReviewSectionsDto })
  sections!: EventReviewSectionsDto;

  @ApiProperty({ type: () => EventReviewCoverageSummaryDto })
  coverage!: EventReviewCoverageSummaryDto;

  @ApiProperty({ type: () => EventReviewSourceTimestampsDto })
  sourceTimestamps!: EventReviewSourceTimestampsDto;

  @ApiProperty({
    enum: ['check_in', 'end_event', 'clinic_summary', 'export'],
    isArray: true,
    description:
      'Actions the user can take from this review, mapped by the client.',
  })
  availableActions!: EventReviewAction[];

  @ApiProperty({ description: 'Review assembly time in ISO 8601 format.' })
  generatedAt!: string;
}

export class EventReviewListDataDto {
  @ApiProperty({ type: () => EventReviewEventDto, isArray: true })
  items!: EventReviewEventDto[];

  @ApiProperty({ description: 'Total matching events for the filter.' })
  total!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Cursor for the next page (last item startedAt in ISO 8601), or null ' +
      'on the last page.',
  })
  nextCursor!: string | null;
}

export class EventReviewResponseDto extends EventReviewDataDto {}

export class EventReviewNullableResponseDto extends EventReviewDataDto {}

export class EventReviewListResponseDto extends EventReviewListDataDto {}
