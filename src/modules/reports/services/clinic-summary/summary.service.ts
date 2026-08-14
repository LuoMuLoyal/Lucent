import { randomBytes, createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { I18nService } from 'nestjs-i18n';
import { PrismaService } from '../../../../prisma';
import {
  badRequest,
  calculateAge,
  now,
  nowIsoString,
} from '../../../../common';
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
  ClinicSummaryShareResponseDto,
} from '../../dto/clinic-summary-response.dto';
import type {
  EventReviewCoverageSummaryDto,
  EventReviewDataDto,
} from '../../dto/event-review-response.dto';
import { EventReviewService } from '../event-review/review.service';
import { ClinicSummaryPdfService } from './pdf.service';
import {
  applySelectedFields,
  CLINIC_SUMMARY_SECTION_KEYS,
} from './summary-view.model';

const SHARE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SHARE_KEY_PREFIX = 'clinic-share:';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE = 'last_30_days';
const RANGE_DAY_COUNTS: Record<string, number> = {
  last_7_days: 7,
  last_30_days: 30,
};
/** Event-scope legacy range label; the event title becomes scopeLabel. */
const EVENT_SCOPE_RANGE_LABEL = 'event';
/** Fixed 资料不足 statement code — never replaced by generic AI conclusions. */
const INSUFFICIENT_COVERAGE_CODE = 'insufficient_coverage';

/** Scope and field-selection options accepted by every summary output path. */
export interface ClinicSummaryOptions {
  /** `last_7_days` | `last_30_days` (default `last_30_days`). */
  range?: string;
  /** Event scope; wins over range/dateFrom/dateTo when supplied. */
  eventId?: string;
  /** Date-range scope start (YYYY-MM-DD); both dates required. */
  dateFrom?: string;
  /** Date-range scope end (YYYY-MM-DD); span capped at 30 days. */
  dateTo?: string;
  /** Sections to include; omit for all sections. */
  selectedFields?: string[];
}

interface ResolvedScope {
  scopeLabel: string;
  dataRange: string;
  start: string;
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

  async createShareLink(
    userId: string,
    locale: string = 'en',
    options: ClinicSummaryOptions = {},
  ): Promise<ClinicSummaryShareResponseDto> {
    const summary = await this.buildClinicSummary(userId, locale, options);
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const key = `${SHARE_KEY_PREFIX}${tokenHash}`;

    await this.cacheManager.set(key, summary, SHARE_TTL_MS);

    const appConfig = this.configService.get<{ publicBaseUrl: string }>(
      ConfigKey.App,
    );
    const baseUrl = appConfig?.publicBaseUrl ?? 'http://localhost:3000';

    return {
      shareUrl: `${baseUrl}/api/v1/user/reports/clinic-summary/shared/${token}`,
      expiresAt: new Date(Date.now() + SHARE_TTL_MS).toISOString(),
    };
  }

  async getSharedSummary(token: string): Promise<ClinicSummaryDto | null> {
    const tokenHash = this.hashToken(token);
    const key = `${SHARE_KEY_PREFIX}${tokenHash}`;
    const cached = await this.cacheManager.get<ClinicSummaryDto>(key);
    if (cached == null) return null;

    // Gate the cached copy against the persisted share grant: revoked or
    // expired shares are denied even when a cached copy exists. A missing
    // store record means a legacy pre-persistence share — the cache copy is
    // its only source of truth (expiry is handled by the cache TTL).
    const record = await this.prisma.userClinicSummaryShare.findFirst({
      where: { tokenHash },
    });
    if (record == null) return cached;
    const nowMs = Date.now();
    if (record.revokedAt != null || record.expiresAt.getTime() <= nowMs) {
      return null;
    }

    const accessedAt = new Date();
    await this.prisma.userClinicSummaryShare.update({
      where: { id: record.id },
      data: {
        accessCount: { increment: 1 },
        lastAccessedAt: accessedAt,
        ...(record.firstAccessedAt == null
          ? { firstAccessedAt: accessedAt }
          : {}),
      },
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

  private async resolveScope(
    userId: string,
    options: ClinicSummaryOptions,
  ): Promise<ResolvedScope> {
    // Event scope wins (plan: event scope 优先).
    if (options.eventId != null && options.eventId !== '') {
      if (this.eventReview == null) {
        throw new Error('Event scope requires the event review service.');
      }
      const review = await this.eventReview.buildForEvent(
        userId,
        options.eventId,
      );
      return {
        scopeLabel: review.event.title,
        dataRange: EVENT_SCOPE_RANGE_LABEL,
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
      badRequest(`不支持的 summary 范围: ${range}`);
    }

    // Custom date range (both bounds required, span capped at the existing
    // product safety cap — the legacy summary never exceeded 30 days).
    if (options.dateFrom != null || options.dateTo != null) {
      if (options.dateFrom == null || options.dateTo == null) {
        badRequest('dateFrom 与 dateTo 必须同时指定');
      }
      const startDate = new Date(options.dateFrom);
      const endDate = new Date(options.dateTo);
      if (
        Number.isNaN(startDate.getTime()) ||
        Number.isNaN(endDate.getTime())
      ) {
        badRequest('无效的日期范围');
      }
      const spanDays = Math.round(
        (endDate.getTime() - startDate.getTime()) / MS_PER_DAY,
      );
      if (spanDays < 0) {
        badRequest('dateFrom 不能晚于 dateTo');
      }
      if (spanDays > CLINIC_SUMMARY_MAX_RANGE_DAYS) {
        badRequest(
          `日期范围不能超过 ${String(CLINIC_SUMMARY_MAX_RANGE_DAYS)} 天`,
        );
      }
      return {
        scopeLabel: 'custom',
        dataRange: 'custom',
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        review,
      };
    }

    const end = now();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    return {
      scopeLabel: range,
      dataRange: range,
      start: start.toISOString(),
      end: end.toISOString(),
      review,
    };
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

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
