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
    const cacheKey = `${ReportsService.CACHE_KEY_PREFIX}:${userId}:${range}:${query.startDate ?? 'auto'}:${query.endDate ?? 'auto'}:${locale}`;

    let cached: ReportDashboardDataDto | undefined;
    try {
      cached = await this.cache.get<ReportDashboardDataDto>(cacheKey);
    } catch (error) {
      const { traceId, spanId } = getActiveTraceIds();
      this.logger.warn(
        { error, key: cacheKey, traceId, spanId },
        'Reports dashboard cache get failed',
      );
      throw error;
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
   * Invalidates all dashboard cache entries for a user by enumerating
   * cache keys with the user's segment and deleting matching ones.
   *
   * Cache is an accelerator (DB is source of truth), so failures are
   * logged as warnings and do not throw — TTL expiry is the safety net.
   */
  async invalidateUserDashboard(userId: string): Promise<void> {
    const userSegment = `${ReportsService.CACHE_KEY_PREFIX}:${userId}:`;
    try {
      const stores = this.cache.stores as
        | Array<{ keys?: () => Promise<string[]> }>
        | undefined;
      if (!stores || stores.length === 0) return;

      for (const store of stores) {
        if (!store.keys) continue;
        let keys: string[];
        try {
          keys = await store.keys();
        } catch (error) {
          const { traceId, spanId } = getActiveTraceIds();
          this.logger.warn(
            { error, userSegment, traceId, spanId },
            'Reports dashboard cache key enumeration failed',
          );
          continue;
        }
        const matching = keys.filter((key) => key.includes(userSegment));
        await Promise.all(
          matching.map((key) =>
            this.cache.del(key).catch((error: unknown) => {
              const { traceId, spanId } = getActiveTraceIds();
              this.logger.warn(
                { error, key, traceId, spanId },
                'Reports dashboard cache del failed',
              );
            }),
          ),
        );
      }
    } catch (error) {
      const { traceId, spanId } = getActiveTraceIds();
      this.logger.warn(
        { error, userId, traceId, spanId },
        'Reports dashboard cache invalidation failed',
      );
    }
  }
}
