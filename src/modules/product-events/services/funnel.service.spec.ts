import { ProductEventName } from '#generated/prisma/client.js';
import type { PrismaService } from '../../../prisma/index.js';
import type {
  ResultAsync,
  DomainFailure,
} from '../../../common/result/index.js';
import {
  DEFAULT_FUNNEL_WINDOW_DAYS,
  MIN_FUNNEL_GROUP_SIZE,
  ProductFunnelService,
  isFunnelEventNameAccountedFor,
} from './funnel.service.js';

interface RawRow {
  day: string;
  name: string;
  count: number;
}

function row(day: string, name: string, count = 1): RawRow {
  return { day, name, count };
}

function buildPrisma() {
  return {
    $queryRaw: vi.fn(),
  };
}

/** Query params actually sent to PostgreSQL (Prisma.sql tagged template). */
function queryValues(prisma: ReturnType<typeof buildPrisma>): unknown[] {
  const firstCall = prisma.$queryRaw.mock.calls[0];
  if (firstCall == null) {
    return [];
  }
  const sql = firstCall[0] as { values?: unknown[] } | undefined;
  return sql?.values ?? [];
}

/** Raw SQL text actually sent to PostgreSQL (Prisma.sql tagged template). */
function queryText(prisma: ReturnType<typeof buildPrisma>): string {
  const firstCall = prisma.$queryRaw.mock.calls[0];
  if (firstCall == null) {
    return '';
  }
  const sql = firstCall[0] as { text?: string } | undefined;
  return sql?.text ?? '';
}

function asDate(value: unknown): Date {
  expect(value).toBeInstanceOf(Date);
  return value as Date;
}

/** Folds a ResultAsync into a plain outcome so specs can assert code/value. */
async function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

/** Unwraps a ResultAsync, failing the test when it is an Err. */
async function unwrapOk<T>(result: ResultAsync<T, DomainFailure>): Promise<T> {
  const outcome = await collectResult(result);
  if (!outcome.ok) {
    throw new Error(`Expected ok result, got ${outcome.error.code}`);
  }
  return outcome.value;
}

describe('ProductFunnelService', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let service: ProductFunnelService;

  beforeEach(() => {
    prisma = buildPrisma();
    service = new ProductFunnelService(prisma as unknown as PrismaService);
  });

  it('aggregates events across users into the core stages with no per-user leakage', async () => {
    // Two users' events arrive as one cross-user grouping (the raw query has
    // no user filter); counts must combine and the response must expose no
    // user identity anywhere.
    prisma.$queryRaw.mockResolvedValue([
      row('2026-08-14', 'health_event_started', 5),
      row('2026-08-14', 'suggestion_impression', 4),
      row('2026-08-14', 'review_opened', 3),
    ]);

    const result = await unwrapOk(
      service.getFunnel({
        dateFrom: '2026-08-14',
        dateTo: '2026-08-14',
      }),
    );

    expect(result.totals).toEqual({
      eventStarted: 5,
      suggestionImpression: 4,
      suggestionActioned: 0,
      eventEndedOrOutcome: 0,
      reviewOpened: 3,
    });
    expect(result.daily).toEqual([
      {
        date: '2026-08-14',
        eventStarted: 5,
        suggestionImpression: 4,
        suggestionActioned: 0,
        eventEndedOrOutcome: 0,
        reviewOpened: 3,
      },
    ]);
    // No field in the serialized response can carry a user id or content.
    const json = JSON.stringify(result);
    expect(json).not.toContain('userId');
    expect(json).not.toContain('user_id');
    expect(json).not.toContain('suggestionRuleCode');
    expect(json).not.toContain('symptom');
  });

  it('groups events into the right UTC calendar days and sorts ascending', async () => {
    // Counts must sum to >= MIN_FUNNEL_GROUP_SIZE so the daily breakdown is
    // not suppressed by the small-sample threshold.
    prisma.$queryRaw.mockResolvedValue([
      row('2026-08-13', 'health_event_started', 3),
      row('2026-08-14', 'health_event_started', 5),
      row('2026-08-12', 'review_opened', 4),
    ]);

    const result = await unwrapOk(
      service.getFunnel({
        dateFrom: '2026-08-12',
        dateTo: '2026-08-14',
      }),
    );

    expect(result.daily.map((d) => d.date)).toEqual([
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
    ]);
    expect(result.daily[2]).toMatchObject({ eventStarted: 5 });
  });

  it('queries an exclusive UTC-day window [dateFrom 00:00, dateTo+1d 00:00)', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await unwrapOk(
      service.getFunnel({
        dateFrom: '2026-08-14',
        dateTo: '2026-08-16',
      }),
    );

    const [from, to] = queryValues(prisma);
    expect(asDate(from).toISOString()).toBe('2026-08-14T00:00:00.000Z');
    expect(asDate(to).toISOString()).toBe('2026-08-17T00:00:00.000Z');

    // Lock the query shape too: bucketing must be explicit-UTC and grouped by
    // day × name — otherwise a silent regression could switch to the session
    // timezone or a per-row scan and only show up in live e2e.
    const text = queryText(prisma);
    expect(text).toContain("AT TIME ZONE 'UTC'");
    expect(text).toContain('GROUP BY 1, 2');
  });

  it('buckets a +08:00-offset midnight datetime into its UTC calendar day', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    // 2026-08-14T00:30:00+08:00 == 2026-08-13T16:30:00Z → UTC day 08-13;
    // 2026-08-14T23:30:00+08:00 == 2026-08-14T15:30:00Z → UTC day 08-14.
    // The window must be derived from the instants, not the literal date part.
    const result = await unwrapOk(
      service.getFunnel({
        dateFrom: '2026-08-14T00:30:00+08:00',
        dateTo: '2026-08-14T23:30:00+08:00',
      }),
    );

    expect(result.window.dateFrom).toBe('2026-08-13');
    expect(result.window.dateTo).toBe('2026-08-14');
    const [from, to] = queryValues(prisma);
    expect(asDate(from).toISOString()).toBe('2026-08-13T00:00:00.000Z');
    expect(asDate(to).toISOString()).toBe('2026-08-15T00:00:00.000Z');
  });

  it('buckets by the UTC calendar day even when full datetimes are passed', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await unwrapOk(
      service.getFunnel({
        // Boundary instants one millisecond apart fall on different UTC days —
        // the SQL buckets by UTC day; the service window bounds stay at UTC
        // midnight, not at the supplied times.
        dateFrom: '2026-08-14T23:59:59.999Z',
        dateTo: '2026-08-15T00:00:00.000Z',
      }),
    );

    const [from, to] = queryValues(prisma);
    expect(asDate(from).toISOString()).toBe('2026-08-14T00:00:00.000Z');
    expect(asDate(to).toISOString()).toBe('2026-08-16T00:00:00.000Z');
  });

  it('counts health_event_ended and health_event_outcome_confirmed as one stage', async () => {
    prisma.$queryRaw.mockResolvedValue([
      row('2026-08-14', 'health_event_ended', 2),
      row('2026-08-14', 'health_event_outcome_confirmed', 3),
    ]);

    const result = await unwrapOk(
      service.getFunnel({
        dateFrom: '2026-08-14',
        dateTo: '2026-08-14',
      }),
    );

    expect(result.totals.eventEndedOrOutcome).toBe(5);
    expect(result.totals.eventStarted).toBe(0);
  });

  it('counts optional visit-summary events separately, never in the core funnel', async () => {
    prisma.$queryRaw.mockResolvedValue([
      row('2026-08-14', 'visit_summary_previewed', 2),
      row('2026-08-14', 'visit_summary_exported'),
      row('2026-08-14', 'visit_summary_share_created'),
      row('2026-08-14', 'visit_summary_share_opened', 3),
      row('2026-08-14', 'visit_summary_share_revoked', 5),
      row('2026-08-14', 'health_event_started', 12),
    ]);

    const result = await unwrapOk(
      service.getFunnel({
        dateFrom: '2026-08-14',
        dateTo: '2026-08-14',
      }),
    );

    expect(result.optional).toEqual({
      visitSummaryPreviewed: 2,
      visitSummaryExported: 1,
      visitSummaryShareCreated: 1,
      visitSummaryShareOpened: 3,
    });
    // share_revoked is a lifecycle signal, not a funnel metric: counted
    // nowhere. Core funnel sees only health_event_started.
    expect(result.totals).toEqual({
      eventStarted: 12,
      suggestionImpression: 0,
      suggestionActioned: 0,
      eventEndedOrOutcome: 0,
      reviewOpened: 0,
    });
  });

  it('suppresses daily details below the fixed small-sample threshold but keeps totals', async () => {
    prisma.$queryRaw.mockResolvedValue([
      row('2026-08-14', 'health_event_started', MIN_FUNNEL_GROUP_SIZE - 1),
    ]);

    const result = await unwrapOk(
      service.getFunnel({
        dateFrom: '2026-08-14',
        dateTo: '2026-08-14',
      }),
    );

    expect(result.daily).toEqual([]);
    expect(result.window.detailsSuppressed).toBe(true);
    expect(result.totals.eventStarted).toBe(MIN_FUNNEL_GROUP_SIZE - 1);
  });

  it('returns daily details at exactly the threshold', async () => {
    prisma.$queryRaw.mockResolvedValue([
      row('2026-08-14', 'health_event_started', MIN_FUNNEL_GROUP_SIZE),
    ]);

    const result = await unwrapOk(
      service.getFunnel({
        dateFrom: '2026-08-14',
        dateTo: '2026-08-14',
      }),
    );

    expect(result.window.detailsSuppressed).toBe(false);
    expect(result.daily).toHaveLength(1);
    expect(result.daily[0]?.eventStarted).toBe(MIN_FUNNEL_GROUP_SIZE);
  });

  it('gates the threshold on the CORE funnel total — optional events alone never unlock details', async () => {
    prisma.$queryRaw.mockResolvedValue([
      row('2026-08-14', 'visit_summary_previewed', MIN_FUNNEL_GROUP_SIZE + 5),
    ]);

    const result = await unwrapOk(
      service.getFunnel({
        dateFrom: '2026-08-14',
        dateTo: '2026-08-14',
      }),
    );

    expect(result.window.detailsSuppressed).toBe(true);
    expect(result.daily).toEqual([]);
    expect(result.optional.visitSummaryPreviewed).toBe(
      MIN_FUNNEL_GROUP_SIZE + 5,
    );
  });

  it('defaults to the last 30 inclusive UTC days ending today when no params are given', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T12:00:00.000Z'));
    prisma.$queryRaw.mockResolvedValue([]);

    try {
      const result = await unwrapOk(service.getFunnel({}));

      expect(result.window.dateTo).toBe('2026-08-14');
      expect(result.window.dateFrom).toBe('2026-07-16');
      const [from, to] = queryValues(prisma);
      expect(asDate(from).toISOString()).toBe('2026-07-16T00:00:00.000Z');
      expect(asDate(to).toISOString()).toBe('2026-08-15T00:00:00.000Z');
      expect(result.window.detailsSuppressed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults the window to DEFAULT_FUNNEL_WINDOW_DAYS inclusive days', () => {
    expect(DEFAULT_FUNNEL_WINDOW_DAYS).toBe(30);
  });

  it('returns an all-zero response for an empty table', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    const result = await unwrapOk(
      service.getFunnel({
        dateFrom: '2026-08-14',
        dateTo: '2026-08-14',
      }),
    );

    expect(result.totals).toEqual({
      eventStarted: 0,
      suggestionImpression: 0,
      suggestionActioned: 0,
      eventEndedOrOutcome: 0,
      reviewOpened: 0,
    });
    expect(result.optional).toEqual({
      visitSummaryPreviewed: 0,
      visitSummaryExported: 0,
      visitSummaryShareCreated: 0,
      visitSummaryShareOpened: 0,
    });
    expect(result.daily).toEqual([]);
    expect(result.window.dateFrom).toBe('2026-08-14');
    expect(result.window.dateTo).toBe('2026-08-14');
    expect(typeof result.window.generatedAt).toBe('string');
  });

  it('accepts a single-day window (dateFrom == dateTo)', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    const result = await unwrapOk(
      service.getFunnel({
        dateFrom: '2026-08-14',
        dateTo: '2026-08-14',
      }),
    );

    expect(result.window.dateFrom).toBe('2026-08-14');
    expect(result.window.dateTo).toBe('2026-08-14');
  });

  it('rejects a window spanning more than 30 inclusive calendar days', async () => {
    const outcome = await collectResult(
      service.getFunnel({
        dateFrom: '2026-08-14',
        dateTo: '2026-09-13',
      }),
    );

    expect(outcome).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'VALIDATION_FAILED' },
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();

    // Exactly 30 inclusive days is allowed.
    prisma.$queryRaw.mockResolvedValue([]);
    const allowed = await collectResult(
      service.getFunnel({
        dateFrom: '2026-07-16',
        dateTo: '2026-08-14',
      }),
    );
    expect(allowed.ok).toBe(true);
  });

  it('rejects dateFrom after dateTo', async () => {
    const outcome = await collectResult(
      service.getFunnel({
        dateFrom: '2026-08-15',
        dateTo: '2026-08-14',
      }),
    );

    expect(outcome).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'VALIDATION_FAILED' },
    });
  });

  it('rejects a partial date pair', async () => {
    expect(
      await collectResult(service.getFunnel({ dateFrom: '2026-08-14' })),
    ).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'VALIDATION_FAILED' },
    });
    expect(
      await collectResult(service.getFunnel({ dateTo: '2026-08-14' })),
    ).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'VALIDATION_FAILED' },
    });
  });

  it('rejects invalid date strings', async () => {
    expect(
      await collectResult(
        service.getFunnel({ dateFrom: 'not-a-date', dateTo: '2026-08-14' }),
      ),
    ).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'VALIDATION_FAILED' },
    });
    expect(
      await collectResult(
        service.getFunnel({ dateFrom: '2026-08-14', dateTo: '2026-8-4' }),
      ),
    ).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'VALIDATION_FAILED' },
    });
  });

  it('returns VALIDATION_FAILED instead of a typed exception for bad windows', async () => {
    const outcome = await collectResult(
      service.getFunnel({
        dateFrom: '2026-08-14',
        dateTo: '2026-09-13',
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('VALIDATION_FAILED');
    expect(outcome.error.kind).toBe('validation');
  });

  it('accounts for every ProductEventName value — no silent metric dropouts', () => {
    // Enforces the funnel fold's DEV NOTE: a new enum value must be mapped to
    // a core stage or an optional count, or declared uncounted — otherwise
    // the raw query would count it and the fold would silently ignore it.
    const unmapped = Object.values(ProductEventName).filter(
      (name) => !isFunnelEventNameAccountedFor(name),
    );
    expect(unmapped).toEqual([]);
  });
});
