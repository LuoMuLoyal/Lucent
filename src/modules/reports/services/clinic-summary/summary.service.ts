import { randomBytes, createHash } from 'node:crypto';
import { createDomainFailure } from '../../../../common/result';
import { DomainFailureException } from '../../../../common/result/domain-failure.exception';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { I18nService } from 'nestjs-i18n';
import {
  ProductEventName,
  ProductEventResult,
  ProductEventSurface,
} from '#generated/prisma/client';
import { PrismaService } from '../../../../prisma';
import { calculateAge, now, nowIsoString } from '../../../../common';
import { ConfigKey } from '../../../../config/env/config-keys.enum';
import { CLINIC_SUMMARY_MAX_RANGE_DAYS } from '../../dto/clinic-summary-request.dto';
import type {
  ClinicSummaryCoverageDto,
  ClinicSummaryCoverageEntryDto,
  ClinicSummaryDto,
  ClinicSummaryProfileDto,
  ClinicSummaryAllergyDto,
  ClinicSummaryConditionDto,
  ClinicSummaryMedicineDto,
  ClinicSummaryNoteEntryDto,
  ClinicSummaryShareDataDto,
  ClinicSummarySleepEntryDto,
  ClinicSummaryWaterEntryDto,
} from '../../dto/clinic-summary-response.dto';
import type {
  EventReviewCoverageSummaryDto,
  EventReviewDataDto,
} from '../../dto/event-review-response.dto';
import { EventReviewService } from '../event-review/review.service';
import { ClinicSummaryPdfService } from './pdf.service';
import { ProductEventsService } from '../../../product-events';
import type { DailyRecordFact } from '../../../daily-records';
import {
  applySelectedFields,
  CLINIC_SUMMARY_SECTION_KEYS,
} from './summary-view';

const SHARE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Canonical summary range labels — the single source of truth for the fixed
 * scope strings shared by `scopeLabel`/`dataRange` and the fixed-range map
 * below. Mirrors the dashboard's `REPORT_RANGE_*` constants
 * (report-dashboard-query.dto.ts); keep both in sync.
 */
export const SUMMARY_RANGE_LABELS = {
  last7Days: 'last_7_days',
  last30Days: 'last_30_days',
  /** Event-scope range label; the event title becomes scopeLabel. */
  event: 'event',
  /** Custom date-range scope label. */
  custom: 'custom',
} as const;

const DEFAULT_RANGE = SUMMARY_RANGE_LABELS.last30Days;
const RANGE_DAY_COUNTS: Record<string, number> = {
  [SUMMARY_RANGE_LABELS.last7Days]: 7,
  [SUMMARY_RANGE_LABELS.last30Days]: 30,
};
/** Fixed 资料不足 statement code — never replaced by generic AI conclusions. */
export const INSUFFICIENT_COVERAGE_CODE = 'insufficient_coverage';

/**
 * Cache-key prefix of the shared summary view, keyed by the sha256 hex of
 * the plaintext share token. The controller writes this key at share-create
 * time and `getSharedSummary` (the single public-read gate) reads it, so the
 * derivation MUST stay in one place — never re-derive it elsewhere.
 */
export const SHARE_CACHE_KEY_PREFIX = 'clinic-share:token';

/** Cache key of the shared summary view for a plaintext share token. */
export function sharedSummaryCacheKey(token: string): string {
  return `${SHARE_CACHE_KEY_PREFIX}:${createHash('sha256')
    .update(token)
    .digest('hex')}`;
}

/** Scope and field-selection options accepted by every summary output path. */
export interface ClinicSummaryOptions {
  /** `last_7_days` | `last_30_days` (default `last_30_days`). */
  range?: string;
  /** Event scope; wins over range/dateFrom/dateTo when supplied. */
  eventId?: string;
  /**
   * Date-range scope start (YYYY-MM-DD, inclusive calendar day); both
   * dates required.
   */
  dateFrom?: string;
  /**
   * Date-range scope end (YYYY-MM-DD, inclusive calendar day); both dates
   * required; span capped at `CLINIC_SUMMARY_MAX_RANGE_DAYS` inclusive days.
   */
  dateTo?: string;
  /** Sections to include; omit for all sections. */
  selectedFields?: string[];
}

interface ResolvedScope {
  scopeLabel: string;
  dataRange: string;
  /** Window start (ISO 8601). Calendar-day scopes: 00:00 UTC of the first covered day. */
  start: string;
  /**
   * Window end (ISO 8601), EXCLUSIVE. Calendar-day scopes: 00:00 UTC of the
   * day AFTER the last covered day; event scopes: the exact endedAt/now.
   */
  end: string;
  review: EventReviewDataDto | null;
}

@Injectable()
export class ClinicSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly pdfService: ClinicSummaryPdfService,
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
    private readonly productEvents: ProductEventsService,
    @Optional() private readonly eventReview?: EventReviewService,
  ) {}

  async buildClinicSummary(
    userId: string,
    locale: string = 'en',
    options: ClinicSummaryOptions = {},
  ): Promise<ClinicSummaryDto> {
    const user = await this.prisma.user.findFirstOrThrow({
      where: { id: userId, deletedAt: null },
      include: {
        profile: {
          select: { birthDate: true, sexAtBirth: true, bloodType: true },
        },
        allergies: {
          where: { isActive: true },
          select: { label: true, reaction: true, severity: true },
          orderBy: { label: 'asc' },
        },
        conditions: {
          where: { status: 'active' },
          select: { label: true, status: true, diagnosedAt: true },
          orderBy: { label: 'asc' },
        },
        currentMedicines: {
          where: { isCurrent: true },
          select: { displayName: true, doseText: true },
          orderBy: { displayName: 'asc' },
        },
      },
    });

    const scope = await this.resolveScope(userId, options);

    const profile = this.deidentifyProfile(user, locale);
    const allergies = user.allergies.map(
      (a) =>
        ({
          label: a.label,
          reaction: a.reaction,
          severity: a.severity,
        }) satisfies ClinicSummaryAllergyDto,
    );
    const conditions = user.conditions.map(
      (c) =>
        ({
          label: c.label,
          status: c.status,
          diagnosedYear: c.diagnosedAt?.getFullYear() ?? null,
        }) satisfies ClinicSummaryConditionDto,
    );
    const currentMedicines = user.currentMedicines.map(
      (m) =>
        ({
          displayName: m.displayName,
          doseText: m.doseText,
        }) satisfies ClinicSummaryMedicineDto,
    );

    // Fetch daily records in the summary window for water/sleep/notes
    // entries. The window is defined by the resolved scope start/end.
    const dailyRecords = await this.fetchDailyRecords(
      userId,
      new Date(scope.start),
      new Date(scope.end),
    );

    const summary: ClinicSummaryDto = {
      generatedAt: nowIsoString(),
      dataRange: scope.dataRange,
      scopeLabel: scope.scopeLabel,
      start: scope.start,
      end: scope.end,
      selectedFields: [...CLINIC_SUMMARY_SECTION_KEYS],
      profile,
      allergies,
      conditions,
      currentMedicines,
      findings: this.buildFindings(scope.review),
      coverage: this.buildCoverage(scope.review),
      waterEntries: this.buildWaterEntries(dailyRecords),
      sleepEntries: this.buildSleepEntries(dailyRecords),
      noteEntries: this.buildNoteEntries(dailyRecords),
      disclaimer: this.i18n.t('reports-clinic-summary.disclaimer', {
        lang: locale,
      }),
    };
    // Single selected-field view model: preview, PDF and share all consume
    // this filtered view, so deselected fields cannot reach any path.
    return applySelectedFields(
      summary,
      options.selectedFields,
    ) as ClinicSummaryDto;
  }

  /**
   * Legacy cache-only share creation — superseded by the revocable
   * `ShareService` flow wired in the controller (Task 4). Kept for the
   * legacy pre-persistence bridge in `getSharedSummary` and its spec;
   * removal is scheduled for the Task 10 cleanup. New code must use
   * `ShareService.createShare` (persisted, revocable record) instead; the
   * controller no longer calls this method.
   */
  async createShareLink(
    userId: string,
    locale: string = 'en',
    options: ClinicSummaryOptions = {},
  ): Promise<ClinicSummaryShareDataDto> {
    const summary = await this.buildClinicSummary(userId, locale, options);
    const token = randomBytes(32).toString('hex');
    const key = sharedSummaryCacheKey(token);

    await this.cacheManager.set(key, summary, SHARE_TTL_MS);

    const appConfig = this.configService.get<{ publicBaseUrl: string }>(
      ConfigKey.App,
    );
    const baseUrl = appConfig?.publicBaseUrl ?? 'http://localhost:3000';

    return {
      shareUrl: `${baseUrl}/api/v1/user/reports/clinic-summary/shared/${token}`,
      expiresAt: new Date(now().getTime() + SHARE_TTL_MS).toISOString(),
    };
  }

  async getSharedSummary(token: string): Promise<ClinicSummaryDto | null> {
    const key = sharedSummaryCacheKey(token);
    const cached = await this.cacheManager.get<ClinicSummaryDto>(key);
    if (cached == null) return null;

    // Gate the cached copy against the persisted share grant: revoked or
    // expired shares are denied even when a cached copy exists. A missing
    // store record means a legacy pre-persistence share — the cache copy is
    // its only source of truth (expiry is handled by the cache TTL), so no
    // gate applies.
    const record = await this.prisma.userClinicSummaryShare.findFirst({
      where: { tokenHash: createHash('sha256').update(token).digest('hex') },
    });
    if (record == null) return cached;
    const nowDate = now();
    if (
      record.revokedAt != null ||
      record.expiresAt.getTime() <= nowDate.getTime()
    ) {
      return null;
    }

    // Guarded write closes the read→write race (ShareService pattern): the
    // WHERE re-checks revokedAt/expiresAt, so a share revoked mid-flight
    // records no access and yields null instead of serving the cached copy.
    const result = await this.prisma.userClinicSummaryShare.updateMany({
      where: { id: record.id, revokedAt: null, expiresAt: { gt: nowDate } },
      data: {
        accessCount: { increment: 1 },
        lastAccessedAt: nowDate,
        ...(record.firstAccessedAt == null ? { firstAccessedAt: nowDate } : {}),
      },
    });
    if (result.count === 0) return null;

    // Single share_opened emission per successful public read. Attributed to
    // the share OWNER's userId (the persisted grant is the only identity
    // here) — the visitor's identity/IP is never part of the payload, and
    // legacy cache-only shares (no store record) emit nothing because there
    // is no owner to attribute to. No deterministic clientEventId: each
    // successful open is a DISTINCT event (accessCount increments per open
    // too), so the per-emission `server-<uuid>` default is intentional.
    await this.productEvents.emitServerEvent(record.userId, {
      name: ProductEventName.visit_summary_share_opened,
      surface: ProductEventSurface.system,
      result: ProductEventResult.success,
    });
    return cached;
  }

  async exportPdf(
    userId: string,
    locale: string,
    options: ClinicSummaryOptions = {},
  ): Promise<Buffer> {
    const summary = await this.buildClinicSummary(userId, locale, options);
    return this.pdfService.buildPdf(summary, locale);
  }

  async exportSharedPdf(token: string, locale: string): Promise<Buffer | null> {
    const summary = await this.getSharedSummary(token);
    if (!summary) return null;
    return this.pdfService.buildPdf(summary, locale);
  }

  // ── Scope resolution ──────────────────────────────────────

  private validationFailed(message: string): never {
    throw new DomainFailureException(
      createDomainFailure({
        kind: 'validation',
        code: 'VALIDATION_FAILED',
        detail: message,
      }),
    );
  }

  private async resolveScope(
    userId: string,
    options: ClinicSummaryOptions,
  ): Promise<ResolvedScope> {
    // Event scope wins (plan: event scope 优先).
    if (options.eventId != null && options.eventId !== '') {
      if (this.eventReview == null) {
        throw new DomainFailureException(
          createDomainFailure({
            kind: 'internal',
            code: 'INTERNAL_ERROR',
            detail: 'Event scope requires the event review service.',
          }),
        );
      }
      const review = await this.eventReview.buildForEvent(
        userId,
        options.eventId,
      );
      return {
        scopeLabel: review.event.title,
        dataRange: SUMMARY_RANGE_LABELS.event,
        start: review.event.startedAt,
        end: review.event.endedAt ?? nowIsoString(),
        review,
      };
    }

    const review =
      this.eventReview == null
        ? null
        : await this.eventReview.buildCurrent(userId);

    const range = options.range ?? DEFAULT_RANGE;
    const days = RANGE_DAY_COUNTS[range];
    if (days == null) {
      this.validationFailed(`不支持的 summary 范围: ${range}`);
    }

    // Custom date range. Semantics: the window covers dateFrom..dateTo
    // INCLUSIVE (both calendar days, UTC); the response `end` is the
    // exclusive upper bound (dateTo + 1 day at 00:00 UTC). The span is
    // capped at the existing product safety cap — at most
    // CLINIC_SUMMARY_MAX_RANGE_DAYS inclusive calendar days. Note: findings
    // and coverage are still bound to the current/relevant event review (or
    // 资料不足 when none exists) and do NOT honor the date window yet —
    // content-window binding is a later task.
    if (options.dateFrom != null || options.dateTo != null) {
      if (options.dateFrom == null || options.dateTo == null) {
        this.validationFailed('dateFrom 与 dateTo 必须同时指定');
      }
      const startDate = new Date(options.dateFrom);
      const endDate = new Date(options.dateTo);
      if (
        Number.isNaN(startDate.getTime()) ||
        Number.isNaN(endDate.getTime())
      ) {
        this.validationFailed('无效的日期范围');
      }
      const spanDays = Math.round(
        (endDate.getTime() - startDate.getTime()) / MS_PER_DAY,
      );
      if (spanDays < 0) {
        this.validationFailed('dateFrom 不能晚于 dateTo');
      }
      // spanDays is the day DIFFERENCE; the inclusive calendar-day count is
      // spanDays + 1 (dateFrom == dateTo is a valid single-day window).
      if (spanDays + 1 > CLINIC_SUMMARY_MAX_RANGE_DAYS) {
        this.validationFailed(
          `日期范围不能超过 ${String(CLINIC_SUMMARY_MAX_RANGE_DAYS)} 天`,
        );
      }
      return {
        scopeLabel: SUMMARY_RANGE_LABELS.custom,
        dataRange: SUMMARY_RANGE_LABELS.custom,
        start: startDate.toISOString(),
        end: new Date(endDate.getTime() + MS_PER_DAY).toISOString(),
        review,
      };
    }

    // Fixed ranges follow the same calendar-day convention: [start, end)
    // covers `days` inclusive UTC calendar days ending today.
    const end = this.startOfNextUtcDay();
    const start = new Date(end.getTime() - days * MS_PER_DAY);
    return {
      scopeLabel: range,
      dataRange: range,
      start: start.toISOString(),
      end: end.toISOString(),
      review,
    };
  }

  /** 00:00 UTC of the day after today — the exclusive end of today's window. */
  private startOfNextUtcDay(): Date {
    const today = now();
    today.setUTCHours(0, 0, 0, 0);
    return new Date(today.getTime() + MS_PER_DAY);
  }

  // ── Findings & coverage (event-review facts only) ─────────

  /**
   * Findings reuse the event review's structured facts and change codes
   * verbatim: available sections contribute their fact code, unknown
   * sections their fixed reason code. When no review exists (or nothing
   * computable) the fixed 资料不足 statement `insufficient_coverage` is
   * returned — no generic AI conclusions are ever fabricated.
   */
  private buildFindings(review: EventReviewDataDto | null): string[] {
    if (review == null) return [INSUFFICIENT_COVERAGE_CODE];
    const findings: string[] = [];
    const { whatHappened, keyChanges, completedActions, nextStep } =
      review.sections;
    for (const section of [
      whatHappened,
      keyChanges,
      completedActions,
      nextStep,
    ]) {
      if (section.state === 'available' && section.facts != null) {
        findings.push(section.facts.code);
      } else if (section.reasonCode != null) {
        findings.push(section.reasonCode);
      }
    }
    return findings.length > 0 ? findings : [INSUFFICIENT_COVERAGE_CODE];
  }

  /** Unified water/dose/sleep coverage mapped from the event review sources. */
  private buildCoverage(
    review: EventReviewDataDto | null,
  ): ClinicSummaryCoverageDto {
    if (review == null) {
      const empty = this.emptyCoverageEntry();
      return { checkIns: empty, water: empty, dose: empty, sleep: empty };
    }
    return {
      checkIns: this.toCoverageEntry(review.coverage.checkIns),
      // water and sleep both derive from daily records.
      water: this.toCoverageEntry(review.coverage.dailyRecords),
      sleep: this.toCoverageEntry(review.coverage.dailyRecords),
      dose: this.toCoverageEntry(review.coverage.doseLogs),
    };
  }

  // ── Daily records (water/sleep/notes entries) ────────────────

  /**
   * Fetches daily records in the summary window for water/sleep/notes
   * entries. Non-deleted records only.
   */
  private async fetchDailyRecords(
    userId: string,
    start: Date,
    end: Date,
  ): Promise<DailyRecordFact[]> {
    const records = await this.prisma.userDailyRecord.findMany({
      where: {
        userId,
        deletedAt: null,
        occurredAt: { gte: start, lt: end },
      },
      orderBy: { occurredAt: 'asc' },
      select: {
        id: true,
        kind: true,
        occurredAt: true,
        occurredTime: true,
        title: true,
        value: true,
        unit: true,
        note: true,
        payload: true,
        createdAt: true,
      },
    });
    return records;
  }

  /**
   * Water entries: only records with kind=water and a parsable ml value.
   * The value field may contain a numeric string; the payload may carry a
   * structured `ml` property. Both paths are tried.
   */
  private buildWaterEntries(
    records: DailyRecordFact[],
  ): ClinicSummaryWaterEntryDto[] {
    const entries: ClinicSummaryWaterEntryDto[] = [];
    for (const r of records) {
      if (r.kind !== 'water') continue;
      const ml = this.parseMl(r);
      if (ml != null && ml > 0) {
        entries.push({
          date: this.toDateString(r.occurredAt),
          ml,
        });
      }
    }
    return entries;
  }

  /**
   * Sleep entries: only records with kind=sleep and a positive duration.
   * The value field may contain minutes or an ISO duration; payload may
   * carry `minutes` or `hours`.
   */
  private buildSleepEntries(
    records: DailyRecordFact[],
  ): ClinicSummarySleepEntryDto[] {
    const entries: ClinicSummarySleepEntryDto[] = [];
    for (const r of records) {
      if (r.kind !== 'sleep') continue;
      const minutes = this.parseMinutes(r);
      if (minutes != null && minutes > 0) {
        entries.push({
          date: this.toDateString(r.occurredAt),
          minutes,
        });
      }
    }
    return entries;
  }

  /**
   * Note entries: any record with a non-empty note field. Includes date,
   * record kind, and the original note text.
   */
  private buildNoteEntries(
    records: DailyRecordFact[],
  ): ClinicSummaryNoteEntryDto[] {
    const entries: ClinicSummaryNoteEntryDto[] = [];
    for (const r of records) {
      if (!r.note || r.note.trim() === '') continue;
      entries.push({
        date: this.toDateString(r.occurredAt),
        kind: r.kind,
        text: r.note,
      });
    }
    return entries;
  }

  /** Parse a milliliter value from a daily record (value or payload.ml). */
  private parseMl(r: DailyRecordFact): number | null {
    // Try value field first.
    if (r.value != null) {
      const parsed = parseFloat(r.value);
      if (!Number.isNaN(parsed) && parsed > 0) return Math.round(parsed);
    }
    // Try payload['ml'].
    if (r.payload != null && typeof r.payload === 'object') {
      const ml = (r.payload as Record<string, unknown>)['ml'];
      if (typeof ml === 'number' && ml > 0) return Math.round(ml);
      if (typeof ml === 'string') {
        const parsed = parseFloat(ml);
        if (!Number.isNaN(parsed) && parsed > 0) return Math.round(parsed);
      }
    }
    return null;
  }

  /** Parse a duration in minutes from a daily record (value or payload). */
  private parseMinutes(r: DailyRecordFact): number | null {
    // Try payload['minutes'] first.
    if (r.payload != null && typeof r.payload === 'object') {
      const payload = r.payload as Record<string, unknown>;
      const minutes = payload['minutes'];
      if (typeof minutes === 'number' && minutes > 0)
        return Math.round(minutes);
      const hours = payload['hours'];
      if (typeof hours === 'number' && hours > 0) {
        return Math.round(hours * 60);
      }
    }
    // Try value field.
    if (r.value != null) {
      const parsed = parseFloat(r.value);
      if (!Number.isNaN(parsed) && parsed > 0) {
        // If unit is hours, convert; otherwise assume minutes.
        const unit = r.unit?.toLowerCase() ?? '';
        if (unit.includes('h') && !unit.includes('min')) {
          return Math.round(parsed * 60);
        }
        return Math.round(parsed);
      }
    }
    return null;
  }

  /** Format a Date as a YYYY-MM-DD calendar date. */
  private toDateString(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private toCoverageEntry(
    entry: EventReviewCoverageSummaryDto[keyof EventReviewCoverageSummaryDto],
  ): ClinicSummaryCoverageEntryDto {
    return {
      state: entry.state,
      coverage: entry.coverage,
      sources: entry.sources,
      observedCount: entry.observedCount,
      expectedCount: entry.expectedCount,
      windowStart: entry.windowStart,
      windowEnd: entry.windowEnd,
    };
  }

  private emptyCoverageEntry(): ClinicSummaryCoverageEntryDto {
    return {
      state: 'unknown',
      coverage: 'none',
      sources: [],
      observedCount: 0,
      expectedCount: null,
      windowStart: null,
      windowEnd: null,
    };
  }

  // ── De-identification ──────────────────────────────────────

  private deidentifyProfile(
    user: {
      nickname: string | null;
      profile: {
        birthDate: Date | null;
        sexAtBirth: string | null;
        bloodType: string | null;
      } | null;
    },
    locale: string,
  ): ClinicSummaryProfileDto {
    const p = user.profile;

    return {
      nickname: this.maskName(user.nickname, locale),
      age: p?.birthDate ? calculateAge(p.birthDate) : null,
      sexAtBirth: p?.sexAtBirth ?? null,
      bloodType: p?.bloodType ?? null,
    };
  }

  private maskName(name: string | null, locale: string): string {
    if (!name)
      return this.i18n.t('reports-clinic-summary.anonymous_name', {
        lang: locale,
      });
    if (name.length <= 1) return name;
    return name.charAt(0) + '**';
  }
}
