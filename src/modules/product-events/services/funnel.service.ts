import { Injectable } from '@nestjs/common';
import { Prisma, ProductEventName } from '#generated/prisma/client';
import { badRequest, now } from '../../../common';
import { PrismaService } from '../../../prisma';
import {
  MAX_FUNNEL_RANGE_DAYS,
  type FunnelQueryDto,
} from '../dto/funnel-query.dto';
import type {
  FunnelDailyCountsDto,
  FunnelOptionalCountsDto,
  FunnelResponseDto,
} from '../dto/funnel-response.dto';

/**
 * Small-sample threshold: when the window's core-funnel total (sum of the
 * five core stage counts) is below this fixed number, per-day group details
 * are suppressed (`daily: []`, `detailsSuppressed: true`) so a small sample
 * can never be broken down in a way that hints at individual users. Window
 * totals are still returned. Tests lock both sides of the boundary.
 */
export const MIN_FUNNEL_GROUP_SIZE = 10;

/** Default query window: the last N inclusive UTC calendar days ending today. */
export const DEFAULT_FUNNEL_WINDOW_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** One aggregated row from the raw day×name grouping. */
interface FunnelAggregateRow {
  /** UTC calendar day (YYYY-MM-DD). */
  day: string;
  /** Raw event name — the enum-backed column arrives as a plain string. */
  name: string;
  count: number;
}

/**
 * Core funnel counts (the five stages). Plain object shape mirroring the
 * response DTO minus `date` — an interface, not the DTO class, so count
 * objects can be spread and summed without class-instance semantics. Drift
 * from `FunnelDailyCountsDto` is caught by the typechecker: every stage key
 * in `CORE_STAGE_BY_EVENT_NAME` must index both shapes.
 */
interface CoreCounts {
  eventStarted: number;
  suggestionImpression: number;
  suggestionActioned: number;
  eventEndedOrOutcome: number;
  reviewOpened: number;
}

/**
 * Core funnel stages (plan: event started → suggestion impression/actioned →
 * event ended/outcome → review opened). `health_event_ended` and
 * `health_event_outcome_confirmed` share the same stage on purpose: the end
 * flow carries the outcome in `result` (Task 6) and check-ins confirm an
 * outcome per calendar day — both are the same user-visible "ended/outcome"
 * step, so the funnel counts them together.
 */
const CORE_STAGE_BY_EVENT_NAME: Readonly<
  Partial<Record<ProductEventName, keyof CoreCounts>>
> = {
  [ProductEventName.health_event_started]: 'eventStarted',
  [ProductEventName.suggestion_impression]: 'suggestionImpression',
  [ProductEventName.suggestion_actioned]: 'suggestionActioned',
  [ProductEventName.health_event_ended]: 'eventEndedOrOutcome',
  [ProductEventName.health_event_outcome_confirmed]: 'eventEndedOrOutcome',
  [ProductEventName.review_opened]: 'reviewOpened',
};

/**
 * OPTIONAL visit-summary events — counted separately and NEVER part of the
 * core funnel success criteria (plan: 单独输出 optional，不把它作为核心漏斗
 * 成功条件). `visit_summary_share_revoked` is a lifecycle signal with no
 * funnel meaning and is intentionally not counted anywhere.
 */
const OPTIONAL_COUNT_BY_EVENT_NAME: Readonly<
  Partial<Record<ProductEventName, keyof FunnelOptionalCountsDto>>
> = {
  [ProductEventName.visit_summary_previewed]: 'visitSummaryPreviewed',
  [ProductEventName.visit_summary_exported]: 'visitSummaryExported',
  [ProductEventName.visit_summary_share_created]: 'visitSummaryShareCreated',
  [ProductEventName.visit_summary_share_opened]: 'visitSummaryShareOpened',
};

/**
 * Aggregated product-loop queries (Task 9). The events table is write-only on
 * the request path; this service is the first read surface, and it is
 * strictly aggregate — no per-user event lists, no health content anywhere in
 * the response (counts and dates only).
 *
 * Timezone: days are UTC calendar days. `occurredAt` is a client-reported
 * ISO instant stored as timestamptz; bucketing by UTC day is the simplest
 * consistent choice and matches the 90-day retention cleanup, which also
 * scans `occurredAt` in UTC. The bucketing is done in SQL via
 * `AT TIME ZONE 'UTC'` so it does not depend on the connection timezone.
 */
@Injectable()
export class ProductFunnelService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregate the core funnel and the optional visit-summary events over a
   * UTC-calendar-day window. One read over the `occurredAt` index; grouping
   * is cross-user by design, and no user-level detail is ever selected.
   */
  async getFunnel(query: FunnelQueryDto): Promise<FunnelResponseDto> {
    const { dateFrom, dateTo } = this.resolveWindow(query);
    const windowStart = utcDayStart(dateFrom);
    // Exclusive upper bound: the day AFTER dateTo at 00:00 UTC.
    const windowEnd = new Date(utcDayStart(dateTo).getTime() + MS_PER_DAY);

    const rows = await this.prisma.$queryRaw<FunnelAggregateRow[]>(Prisma.sql`
      SELECT to_char(date_trunc('day', occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             name,
             COUNT(*)::int AS count
      FROM user_product_events
      WHERE occurred_at >= ${windowStart} AND occurred_at < ${windowEnd}
      GROUP BY 1, 2
    `);

    const totals = emptyCoreCounts();
    const optional = emptyOptionalCounts();
    const byDay = new Map<string, FunnelDailyCountsDto>();

    for (const row of rows) {
      const coreStage = CORE_STAGE_BY_EVENT_NAME[row.name as ProductEventName];
      if (coreStage != null) {
        totals[coreStage] += row.count;
        let daily = byDay.get(row.day);
        if (daily == null) {
          daily = { date: row.day, ...emptyCoreCounts() };
          byDay.set(row.day, daily);
        }
        daily[coreStage] += row.count;
        continue;
      }
      const optionalKey =
        OPTIONAL_COUNT_BY_EVENT_NAME[row.name as ProductEventName];
      if (optionalKey != null) {
        optional[optionalKey] += row.count;
      }
      // Anything else cannot exist (enum-constrained column); ignoring it
      // keeps the response strictly to the declared count surface.
    }

    const coreTotal =
      totals.eventStarted +
      totals.suggestionImpression +
      totals.suggestionActioned +
      totals.eventEndedOrOutcome +
      totals.reviewOpened;
    const detailsSuppressed = coreTotal < MIN_FUNNEL_GROUP_SIZE;

    return {
      daily: detailsSuppressed
        ? []
        : [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
      optional,
      totals,
      window: {
        dateFrom,
        dateTo,
        generatedAt: now().toISOString(),
        detailsSuppressed,
      },
    };
  }

  /**
   * Resolve the query window: explicit dateFrom/dateTo (both or none, capped
   * at MAX_FUNNEL_RANGE_DAYS inclusive UTC calendar days) or the default last
   * DEFAULT_FUNNEL_WINDOW_DAYS days ending today. Validation mirrors the
   * clinic-summary convention (paired dates, no late-before-early, inclusive
   * span cap).
   */
  private resolveWindow(query: FunnelQueryDto): {
    dateFrom: string;
    dateTo: string;
  } {
    if (query.dateFrom == null && query.dateTo == null) {
      const end = new Date();
      return {
        dateFrom: toUtcDateString(
          new Date(
            end.getTime() - (DEFAULT_FUNNEL_WINDOW_DAYS - 1) * MS_PER_DAY,
          ),
        ),
        dateTo: toUtcDateString(end),
      };
    }
    if (query.dateFrom == null || query.dateTo == null) {
      badRequest('dateFrom 与 dateTo 必须同时指定');
    }

    const start = utcDayStart(query.dateFrom);
    const end = utcDayStart(query.dateTo);
    const spanDays = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
    if (spanDays < 0) {
      badRequest('dateFrom 不能晚于 dateTo');
    }
    // spanDays is the day DIFFERENCE; the inclusive calendar-day count is
    // spanDays + 1 (dateFrom == dateTo is a valid single-day window).
    if (spanDays + 1 > MAX_FUNNEL_RANGE_DAYS) {
      badRequest(`日期范围不能超过 ${String(MAX_FUNNEL_RANGE_DAYS)} 天`);
    }
    return { dateFrom: toUtcDateString(start), dateTo: toUtcDateString(end) };
  }
}

/** Parse an ISO date/datetime into its UTC calendar-day start (00:00 UTC). */
function utcDayStart(value: string): Date {
  const dateOnly = value.slice(0, 10);
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    badRequest('无效的日期范围');
  }
  return date;
}

/** YYYY-MM-DD of the UTC calendar day the instant falls in. */
function toUtcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function emptyCoreCounts(): CoreCounts {
  return {
    eventStarted: 0,
    suggestionImpression: 0,
    suggestionActioned: 0,
    eventEndedOrOutcome: 0,
    reviewOpened: 0,
  };
}

function emptyOptionalCounts(): FunnelOptionalCountsDto {
  return {
    visitSummaryPreviewed: 0,
    visitSummaryExported: 0,
    visitSummaryShareCreated: 0,
    visitSummaryShareOpened: 0,
  };
}
