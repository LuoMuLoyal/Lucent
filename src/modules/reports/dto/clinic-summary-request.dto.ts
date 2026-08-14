import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { ClinicSummaryShareField } from '#generated/prisma/client';

/**
 * Maximum span of a date-range clinic-summary scope, in days. Mirrors the
 * product's largest supported report range (`REPORT_RANGE_LAST_30_DAYS` in
 * report-dashboard-query.dto.ts): the legacy summary default
 * `last_30_days` never exceeded 30 days, so custom date ranges stay within
 * the same safety cap. Enforced at scope-resolution time in
 * `ClinicSummaryService` (which both the controller and the share-store
 * validation converge on).
 */
export const CLINIC_SUMMARY_MAX_RANGE_DAYS = 30;

/** Allowed `selectedFields` values — the fixed share-field enum verbatim. */
export const CLINIC_SUMMARY_SELECTABLE_FIELDS: string[] = Object.values(
  ClinicSummaryShareField,
);

/**
 * Clinic Summary request scope: either `eventId` or a complete
 * `dateFrom`/`dateTo` pair. Event scope wins when both are supplied (the
 * share-record layer in ShareService stays strict XOR at the persistence
 * boundary; the controller forwards only the winning scope). Date ranges are
 * capped at {@link CLINIC_SUMMARY_MAX_RANGE_DAYS}.
 */
export class ClinicSummaryRequestDto {
  @ApiPropertyOptional({
    description:
      'Event scope: build the summary from this event review. Wins over ' +
      'dateFrom/dateTo when both are supplied.',
  })
  @IsOptional()
  @IsString()
  eventId?: string;

  @ApiPropertyOptional({
    description:
      'Date-range scope start (ISO 8601 date, YYYY-MM-DD). Required when ' +
      'eventId is absent; ignored when eventId is present.',
  })
  @ValidateIf((o: ClinicSummaryRequestDto) => o.eventId == null)
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description:
      'Date-range scope end (ISO 8601 date, YYYY-MM-DD). Required when ' +
      `eventId is absent; span must not exceed ${String(CLINIC_SUMMARY_MAX_RANGE_DAYS)} days.`,
  })
  @ValidateIf((o: ClinicSummaryRequestDto) => o.eventId == null)
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({
    enum: CLINIC_SUMMARY_SELECTABLE_FIELDS,
    isArray: true,
    description:
      'Summary sections to include. Empty arrays and unknown values are ' +
      'rejected; when omitted every section is included.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CLINIC_SUMMARY_SELECTABLE_FIELDS.length)
  @IsIn(CLINIC_SUMMARY_SELECTABLE_FIELDS, { each: true })
  selectedFields?: string[];
}
