import { ReportsService } from './get-dashboard.js';
import {
  REPORT_RANGE_LAST_7_DAYS,
  type ReportDashboardQueryDto,
} from '../../application/read_models/dashboard/report-dashboard-query.js';
import type { ReportsComputationService } from '../read_models/dashboard/dashboard-computation.js';
import type { DashboardContextPort } from '../ports/dashboard.js';

/**
 * Minimal in-memory cache double.
 *
 * It deliberately exposes **no `keys()`** anywhere — that is the property the
 * real store has (`cache.stores` holds `Keyv` instances, and `Keyv` has no
 * `keys()`), and the property the old invalidation loop depended on by
 * accident. A double that offered `keys()` would let the deleted
 * enumeration-based implementation pass.
 */
function makeCache() {
  const entries = new Map<string, unknown>();
  return {
    entries,
    get: vi.fn((key: string) => Promise.resolve(entries.get(key))),
    set: vi.fn((key: string, value: unknown) => {
      entries.set(key, value);
      return Promise.resolve();
    }),
    del: vi.fn((key: string) => {
      entries.delete(key);
      return Promise.resolve();
    }),
  };
}

function makeContextService(label: string) {
  return {
    build: vi.fn().mockResolvedValue({
      range: REPORT_RANGE_LAST_7_DAYS,
      startDate: new Date('2026-06-06T00:00:00.000Z'),
      endDate: new Date('2026-06-12T00:00:00.000Z'),
      generatedAt: '2026-06-12T08:00:00.000Z',
      aiSummaryEnabled: true,
      label,
      medicationSeries: [50, 100, 0, 0, 0, 0, 0],
      waterSeries: [1.5, 0, 0, 0, 0, 0, 0],
      sleepSeries: [0, 0, 0, 0, 0, 0, 0],
      mealEstimateSeries: [1, 0, 0, 0, 0, 0, 0],
      mealEstimateTrackedDays: 1,
      mealEstimateBreakdown: {
        analyzedDays: 1,
        analyzingDays: 0,
        failedDays: 0,
      },
    }),
  } as unknown as DashboardContextPort;
}

function makeComputationService(label: string) {
  return {
    compute: vi.fn().mockReturnValue({
      metrics: [
        {
          kind: 'water',
          value: label,
          unit: 'L',
          status: 'stable',
          delta: '0',
          direction: 'flat',
          sparkline: [0, 0, 0, 0, 0, 0, 0],
        },
      ],
      trends: [],
      findings: [],
      patterns: [],
    }),
  } as unknown as ReportsComputationService;
}

const QUERY: ReportDashboardQueryDto = { range: REPORT_RANGE_LAST_7_DAYS };

describe('ReportsService.invalidateUserDashboard', () => {
  it('makes the next read miss the cache and recompute (regression: silent no-op)', async () => {
    // The bug this pins: invalidation deleted nothing, so a reader kept
    // getting the entry written before the change, until the 5-minute TTL.
    const cache = makeCache();
    const contextService = makeContextService('first');
    const computationService = makeComputationService('first');
    const service = new ReportsService(
      contextService,
      computationService,
      cache as never,
    );

    await service.getDashboard('u1', QUERY, 'en');
    expect(contextService.build).toHaveBeenCalledTimes(1);

    // A second read is served from cache — no recompute.
    await service.getDashboard('u1', QUERY, 'en');
    expect(contextService.build).toHaveBeenCalledTimes(1);

    // Invalidate, then read again: it must recompute, not serve the old entry.
    await service.invalidateUserDashboard('u1');

    const contextAfter = makeContextService('second');
    const after = new ReportsService(
      contextAfter,
      makeComputationService('second'),
      cache as never,
    );
    const dashboard = await after.getDashboard('u1', QUERY, 'en');

    expect(contextAfter.build).toHaveBeenCalledTimes(1);
    expect(dashboard.metrics[0]?.value).toBe('second');
  });

  it('invalidates without deleting any key (no enumeration, no KEYS scan)', async () => {
    const cache = makeCache();
    const service = new ReportsService(
      makeContextService('x'),
      makeComputationService('x'),
      cache as never,
    );

    await service.getDashboard('u1', QUERY, 'en');
    await service.invalidateUserDashboard('u1');

    // The generation moved instead of the entries being deleted.
    expect(cache.del).not.toHaveBeenCalled();
    expect(cache.entries.has('reports:dashboard:version:u1')).toBe(true);
    expect(cache.entries.get('reports:dashboard:version:u1')).toBe(1);
  });

  it('scopes the generation to one user', async () => {
    const cache = makeCache();
    const service = new ReportsService(
      makeContextService('x'),
      makeComputationService('x'),
      cache as never,
    );

    await service.getDashboard('u1', QUERY, 'en');
    await service.invalidateUserDashboard('u1');

    // u2's entries are untouched: a second user's read still hits the cache.
    const contextU2 = makeContextService('u2');
    const serviceU2 = new ReportsService(
      contextU2,
      makeComputationService('u2'),
      cache as never,
    );
    await serviceU2.getDashboard('u2', QUERY, 'en');
    await serviceU2.getDashboard('u2', QUERY, 'en');
    expect(contextU2.build).toHaveBeenCalledTimes(1);
  });

  it('keeps a separate generation per range and locale of the same user', async () => {
    // One invalidation must drop every cached variant for the user, which is
    // why the generation is per user rather than per cache key.
    const cache = makeCache();
    const contextService = makeContextService('a');
    const service = new ReportsService(
      contextService,
      makeComputationService('a'),
      cache as never,
    );

    await service.getDashboard('u1', QUERY, 'en');
    await service.getDashboard('u1', QUERY, 'zh-CN');
    expect(contextService.build).toHaveBeenCalledTimes(2);

    await service.invalidateUserDashboard('u1');

    const after = makeContextService('b');
    const afterService = new ReportsService(
      after,
      makeComputationService('b'),
      cache as never,
    );
    await afterService.getDashboard('u1', QUERY, 'en');
    await afterService.getDashboard('u1', QUERY, 'zh-CN');
    expect(after.build).toHaveBeenCalledTimes(2);
  });

  it('throws when the generation bump fails, instead of degrading silently', async () => {
    // The single fallible step. A silent failure here means stale dashboards,
    // so the caller (a queue job) must see it and retry.
    const cache = makeCache();
    cache.set.mockRejectedValue(new Error('redis down'));
    const service = new ReportsService(
      makeContextService('x'),
      makeComputationService('x'),
      cache as never,
    );

    await expect(service.invalidateUserDashboard('u1')).rejects.toThrow(
      'redis down',
    );
  });

  it('treats an unreadable generation as 0 on the read path (fail-open)', async () => {
    const cache = makeCache();
    cache.get.mockRejectedValue(new Error('redis down'));
    const contextService = makeContextService('x');
    const service = new ReportsService(
      contextService,
      makeComputationService('x'),
      cache as never,
    );

    // A cache read failure must not become a 5xx; it recomputes from the DB.
    const dashboard = await service.getDashboard('u1', QUERY, 'en');
    expect(contextService.build).toHaveBeenCalledTimes(1);
    expect(dashboard.range).toBe(REPORT_RANGE_LAST_7_DAYS);
  });

  it('ignores a non-numeric stored generation', async () => {
    const cache = makeCache();
    cache.entries.set('reports:dashboard:version:u1', 'not-a-number');
    const contextService = makeContextService('x');
    const service = new ReportsService(
      contextService,
      makeComputationService('x'),
      cache as never,
    );

    await service.getDashboard('u1', QUERY, 'en');
    const key = cache.set.mock.calls[0]?.[0] as string;
    // Falls back to generation 0 rather than embedding a garbage value.
    expect(key).toContain(':v0:');
  });

  it('advances the generation on every invalidation', async () => {
    const cache = makeCache();
    const service = new ReportsService(
      makeContextService('x'),
      makeComputationService('x'),
      cache as never,
    );

    await service.invalidateUserDashboard('u1');
    await service.invalidateUserDashboard('u1');
    await service.invalidateUserDashboard('u1');

    expect(cache.entries.get('reports:dashboard:version:u1')).toBe(3);
  });
});
