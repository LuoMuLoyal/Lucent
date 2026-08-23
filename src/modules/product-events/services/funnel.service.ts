import { Injectable } from '@nestjs/common';
import { Prisma, ProductEventName } from '#generated/prisma/client';
import { now } from '../../../common';
import {
  createDomainFailure,
  err,
  errAsync,
  ok,
  type DomainFailure,
  type Result,
  type ResultAsync,
} from '../../../common/result';
import { fromPromise } from '../../../common/result';
import { PrismaService } from '../../../prisma';
import {
  MAX_FUNNEL_RANGE_DAYS,
  type FunnelQueryDto,
} from '../dto/funnel-query.dto';
import type {
  FunnelDailyCountsDto,
  FunnelDataDto,
  FunnelOptionalCountsDto,
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

/**
 * Whole UTC days since the epoch of a UTC-midnight instant. Exact by
 * construction (the ms epoch has no leap seconds), so the difference of two
 * such values is the true calendar-day difference — no DST-affected ms
 * rounding can skew a window span.
 */
function utcDayNumber(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_DAY);
}

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
 *
 * DEV NOTE: every new `ProductEventName` enum value MUST be mapped here or in
 * `OPTIONAL_COUNT_BY_EVENT_NAME`, or explicitly declared uncounted in
 * `INTENTIONALLY_UNCOUNTED_EVENT_NAMES` — the raw query counts all names, but
 * the fold below ignores unmapped ones, so an unmapped name silently drops
 * out of the metrics with no error. This is enforced by the completeness
 * spec (`isFunnelEventNameAccountedFor` iterates the enum).
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
 * funnel meaning and is intentionally not counted anywhere (see
 * `INTENTIONALLY_UNCOUNTED_EVENT_NAMES`).
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
 * Enum values deliberately NOT counted anywhere in the funnel — they must
 * still be declared here so the completeness spec can distinguish an
 * intentional exclusion from a forgotten mapping.
 */
const INTENTIONALLY_UNCOUNTED_EVENT_NAMES: ReadonlySet<ProductEventName> =
  new Set([ProductEventName.visit_summary_share_revoked]);

/**
 * Whether a `ProductEventName` is accounted for by the funnel fold: mapped to
 * a core stage, an optional count, or explicitly declared uncounted. The
 * completeness spec iterates the enum and fails when a new value is added
 * without being mapped or declared — no silent metric dropouts.
 */
export function isFunnelEventNameAccountedFor(name: ProductEventName): boolean {
  return (
    CORE_STAGE_BY_EVENT_NAME[name] != null ||
    OPTIONAL_COUNT_BY_EVENT_NAME[name] != null ||
    INTENTIONALLY_UNCOUNTED_EVENT_NAMES.has(name)
  );
}

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
   *
   * Invalid query windows (partial dates, late-before-early, over-long
   * spans, unparseable dates) map to `VALIDATION_FAILED`; unknown database
   * errors rethrow.
   */
  getFunnel(query: FunnelQueryDto): ResultAsync<FunnelDataDto, DomainFailure> {
    const windowResult = this.resolveWindow(query);
    if (windowResult.isErr()) {
      return errAsync(windowResult.error);
    }
    const { dateFrom, dateTo, windowStart, windowEnd } = windowResult.value;

    return fromPromise(
      this.prisma.$queryRaw<FunnelAggregateRow[]>(Prisma.sql`
        SELECT to_char(date_trunc('day', occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
               name,
               COUNT(*)::int AS count
        FROM user_product_events
        WHERE occurred_at >= ${windowStart} AND occurred_at < ${windowEnd}
        GROUP BY 1, 2
      `),
      (error) => {
        throw error;
      },
    ).map((rows) => {
      const totals = emptyCoreCounts();
      const optional = emptyOptionalCounts();
      const byDay = new Map<string, FunnelDailyCountsDto>();

      for (const row of rows) {
        const coreStage =
          CORE_STAGE_BY_EVENT_NAME[row.name as ProductEventName];
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
    });
  }

  /**
   * Resolve the query window: explicit dateFrom/dateTo (both or none, capped
   * at MAX_FUNNEL_RANGE_DAYS inclusive UTC calendar days) or the default last
   * DEFAULT_FUNNEL_WINDOW_DAYS days ending today. Validation mirrors the
   * clinic-summary convention (paired dates, no late-before-early, inclusive
   * span cap) and returns `VALIDATION_FAILED` instead of throwing.
   */
  private resolveWindow(query: FunnelQueryDto): Result<
    {
      dateFrom: string;
      dateTo: string;
      /** UTC-midnight start of the inclusive window (inclusive bound). */
      windowStart: Date;
      /** Exclusive upper bound: the day AFTER `dateTo` at 00:00 UTC. */
      windowEnd: Date;
    },
    DomainFailure
  > {
    if (query.dateFrom == null && query.dateTo == null) {
      const end = new Date();
      const dateFrom = toUtcDateString(
        new Date(end.getTime() - (DEFAULT_FUNNEL_WINDOW_DAYS - 1) * MS_PER_DAY),
      );
      const dateTo = toUtcDateString(end);
      return ok({
        dateFrom,
        dateTo,
        windowStart: new Date(`${dateFrom}T00:00:00.000Z`),
        windowEnd: new Date(
          new Date(`${dateTo}T00:00:00.000Z`).getTime() + MS_PER_DAY,
        ),
      });
    }
    if (query.dateFrom == null || query.dateTo == null) {
      return err(validationFailed());
    }

    const startResult = utcDayStart(query.dateFrom);
    const endResult = utcDayStart(query.dateTo);
    if (startResult.isErr() || endResult.isErr()) {
      return err(validationFailed());
    }
    const start = startResult.value;
    const end = endResult.value;
    // Calendar-day difference: both bounds are UTC-midnight instants, so
    // `utcDayNumber(end) - utcDayNumber(start)` is the exact day count —
    // immune to the ms-rounding drift that `Math.round` over milliseconds
    // would introduce at DST boundaries.
    const spanDays = utcDayNumber(end) - utcDayNumber(start);
    if (spanDays < 0) {
      return err(validationFailed());
    }
    // spanDays is the day DIFFERENCE; the inclusive calendar-day count is
    // spanDays + 1 (dateFrom == dateTo is a valid single-day window).
    if (spanDays + 1 > MAX_FUNNEL_RANGE_DAYS) {
      return err(validationFailed());
    }
    return ok({
      dateFrom: toUtcDateString(start),
      dateTo: toUtcDateString(end),
      windowStart: start,
      windowEnd: new Date(end.getTime() + MS_PER_DAY),
    });
  }
}

function validationFailed(): DomainFailure {
  return createDomainFailure({
    kind: 'validation',
    code: 'VALIDATION_FAILED',
  });
}

/**
 * Parse an ISO date/datetime into its UTC calendar-day start (00:00 UTC).
 * The UTC day is derived from the parsed INSTANT, not the literal date part
 * of the string: a non-Z offset like '2026-08-14T00:30:00+08:00' (accepted by
 * `@IsDateString`) is 2026-08-13T16:30:00Z and therefore falls on UTC day
 * 08-13, per the query contract ("the UTC calendar day is used"). Date-only
 * values ('YYYY-MM-DD') parse as UTC midnight.
 */
function utcDayStart(value: string): Result<Date, DomainFailure> {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return err(validationFailed());
  }
  // The ISO date part must be zero-padded (YYYY-MM-DD) — V8's loose parser
  // would otherwise accept shapes like '2026-8-4', which the contract
  // (`@IsDateString` ISO 8601) does not allow. The check looks at the literal
  // prefix only for FORMAT; the day itself comes from the instant above.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10))) {
    return err(validationFailed());
  }
  const dateOnly = parsed.toISOString().slice(0, 10);
  return ok(new Date(`${dateOnly}T00:00:00.000Z`));
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
