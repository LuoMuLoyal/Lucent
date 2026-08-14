import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { ClinicSummaryShareField } from '#generated/prisma/client';

/**
 * Maximum span of a date-range clinic-summary scope, in INCLUSIVE calendar
 * days (dateFrom..dateTo both counted). Mirrors the product's largest
 * supported report range (`REPORT_RANGE_LAST_30_DAYS` in
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
 * Clinic Summary request scope: `eventId` or a complete `dateFrom`/`dateTo`
 * pair, or neither (an empty scope falls back to the default `last_30_days`
 * range — legacy semantics). Event scope wins when both are supplied (the
 * share-record layer in ShareService stays strict XOR at the persistence
 * boundary; the controller forwards only the winning scope, materializing
 * the default range when no scope is given).
 *
 * Date-range semantics: the window covers `dateFrom`..`dateTo` INCLUSIVE
 * (both calendar days included); the response `end` is the exclusive upper
 * bound (dateTo + 1 day). The span is capped at
 * {@link CLINIC_SUMMARY_MAX_RANGE_DAYS} inclusive calendar days.
 *
 * Known limitation (content-window binding is a later task): findings and
 * coverage are bound to the current/relevant event review (or the fixed
 * 资料不足 statement when no review exists) and do NOT yet honor the custom
 * date window — the window only shapes scopeLabel/start/end.
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
      'Date-range scope start (ISO 8601 date, YYYY-MM-DD). Both dates are ' +
      'required whenever a date range is given (a partial pair is ' +
      'rejected); ignored when eventId is present. When neither eventId nor ' +
      'a date range is supplied, the summary falls back to the default ' +
      'last_30_days range (legacy semantics).',
  })
  @ValidateIf(
    (o: ClinicSummaryRequestDto) =>
      o.eventId == null && (o.dateFrom != null || o.dateTo != null),
  )
  @IsDefined()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description:
      'Date-range scope end (ISO 8601 date, YYYY-MM-DD). Inclusive calendar ' +
      'day; both dates required whenever a date range is given; span must ' +
      'cover at most ' +
      `${String(CLINIC_SUMMARY_MAX_RANGE_DAYS)} inclusive calendar days. ` +
      'When neither eventId nor a date range is supplied, the summary ' +
      'falls back to the default last_30_days range (legacy semantics).',
  })
  @ValidateIf(
    (o: ClinicSummaryRequestDto) =>
      o.eventId == null && (o.dateFrom != null || o.dateTo != null),
  )
  @IsDefined()
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
