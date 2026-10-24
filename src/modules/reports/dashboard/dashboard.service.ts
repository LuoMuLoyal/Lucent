import { formatDateOnly } from '../../../common/index.js';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { getActiveTraceIds } from '../../../common/logger/trace-context.utils.js';
import type { ReportDashboardDataDto } from '../dto/report-dashboard-response.dto.js';

import type { ReportDashboardQueryDto } from '../dto/report-dashboard-query.dto.js';
import { ReportsComputationService } from './computation.service.js';
import { ReportsContextService } from './context.service.js';

@Injectable()
export class ReportsService {
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly CACHE_KEY_PREFIX = 'reports:dashboard';
  /**
   * Per-user cache generation, part of every dashboard cache key.
   *
   * Invalidation bumps this instead of enumerating and deleting keys. The TTL
   * is deliberately far longer than {@link CACHE_TTL_MS}: a version that
   * expired while dashboard entries were still alive would let a reader fall
   * back to an older generation and serve a stale dashboard — the exact bug
   * this replaces. When it does expire, restarting from 0 is safe: every entry
   * of the previous generation is already past its own 5-minute TTL, so there
   * is nothing left to reach.
   */
  private static readonly CACHE_VERSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly contextService: ReportsContextService,
    private readonly computationService: ReportsComputationService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async getDashboard(
    userId: string,
    query: ReportDashboardQueryDto,
    locale: string,
  ): Promise<ReportDashboardDataDto> {
    const range = query.range ?? 'last_7_days';
    const version = await this.readCacheVersion(userId);
    const cacheKey = `${ReportsService.CACHE_KEY_PREFIX}:${userId}:v${String(version)}:${range}:${query.startDate ?? 'auto'}:${query.endDate ?? 'auto'}:${locale}`;

    let cached: ReportDashboardDataDto | undefined;
    try {
      cached = await this.cache.get<ReportDashboardDataDto>(cacheKey);
    } catch (error) {
      const { traceId, spanId } = getActiveTraceIds();
      this.logger.warn(
        { error, key: cacheKey, traceId, spanId },
        'Reports dashboard cache get failed — falling back to recompute',
      );
      // Fail-open like `cache set` below: the cache is an accelerator, the
      // DB is the source of truth. A read failure must not turn a healthy
      // request into a 5xx — recompute from the DB instead.
      cached = undefined;
    }
    if (cached != null) {
      return cached;
    }

    const facts = await this.contextService.build(userId, query);
    const computed = this.computationService.compute(facts, locale);

    const result: ReportDashboardDataDto = {
      range: facts.range,
      startDate: formatDateOnly(facts.startDate),
      endDate: formatDateOnly(facts.endDate),
      generatedAt: facts.generatedAt,
      metrics: computed.metrics,
      trends: computed.trends,
      findings: computed.findings,
      patterns: computed.patterns,
      aiSummaryEnabled: facts.aiSummaryEnabled,
    };

    try {
      await this.cache.set(cacheKey, result, ReportsService.CACHE_TTL_MS);
    } catch (error) {
      const { traceId, spanId } = getActiveTraceIds();
      this.logger.warn(
        { error, key: cacheKey, traceId, spanId },
        'Reports dashboard cache set failed — serving computed result directly',
      );
    }
    this.logger.debug(
      `Cache set: dashboard (userId=${userId}, key=${cacheKey})`,
    );
    return result;
  }

  /**
   * Invalidates every cached dashboard for `userId` by advancing the user's
   * cache generation.
   *
   * The previous implementation walked `cache.stores` looking for a `keys()`
   * method. Neither shape that exists at runtime has one — `cache.stores` holds
   * `Keyv` instances (no `keys()`), and the underlying store is reachable only
   * via `store.store` — so the loop hit `continue` on every store and deleted
   * nothing, silently, with no log line. Entries then lived until the 5-minute
   * TTL. A generation counter removes the enumeration entirely: old entries
   * become unreachable because no reader computes their key any more, and they
   * expire on their own TTL.
   *
   * **Failure behaviour is explicit, unlike the method this replaces.** The
   * version bump is the single fallible step, and it throws rather than
   * degrading quietly: a silent failure here means stale dashboards, so the
   * caller must see it. (The old comment claimed failures were "logged as
   * warnings", but the path that actually mattered logged nothing.) Callers on
   * the queue treat the throw as a job failure and retry; the request path
   * never calls this method.
   */
  async invalidateUserDashboard(userId: string): Promise<void> {
    const key = ReportsService.cacheVersionKey(userId);
    const current = await this.readCacheVersion(userId);
    const next = current + 1;
    await this.cache.set(key, next, ReportsService.CACHE_VERSION_TTL_MS);
    this.logger.debug(
      `Reports dashboard cache invalidated (userId=${userId}, generation=${String(current)} -> ${String(next)})`,
    );
  }

  /** Cache key holding the current generation for `userId`. */
  private static cacheVersionKey(userId: string): string {
    return `${ReportsService.CACHE_KEY_PREFIX}:version:${userId}`;
  }

  /**
   * Current cache generation for `userId`, or 0 when unset/unreadable.
   *
   * A read failure degrades to 0 rather than throwing: this runs on the read
   * path, where the DB is the source of truth and a cache problem must not
   * become a 5xx. Worst case the reader computes a key from generation 0 and
   * misses the cache once — the same fail-open shape as `get`/`set` above.
   */
  private async readCacheVersion(userId: string): Promise<number> {
    try {
      const stored = await this.cache.get<number>(
        ReportsService.cacheVersionKey(userId),
      );
      return typeof stored === 'number' && Number.isFinite(stored) ? stored : 0;
    } catch (error) {
      const { traceId, spanId } = getActiveTraceIds();
      this.logger.warn(
        { error, userId, traceId, spanId },
        'Reports dashboard cache version read failed — treating as generation 0',
      );
      return 0;
    }
  }
}
