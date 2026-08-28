import { formatDateOnly } from '../../../common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import type { ReportDashboardDataDto } from '../dto/report-dashboard-response.dto';

import type { ReportDashboardQueryDto } from '../dto/report-dashboard-query.dto';
import { ReportsComputationService } from './computation.service';
import { ReportsContextService } from './context.service';

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
      this.logger.warn(
        `Reports dashboard cache get failed (key=${cacheKey}): ${String(error)}`,
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
      this.logger.warn(
        `Reports dashboard cache set failed (key=${cacheKey}): ${String(error)}`,
      );
      throw error;
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
        } catch {
          continue;
        }
        const matching = keys.filter((key) => key.includes(userSegment));
        await Promise.all(
          matching.map((key) =>
            this.cache.del(key).catch((error: unknown) => {
              this.logger.warn(
                `Reports dashboard cache del failed (key=${key}): ${String(error)}`,
              );
            }),
          ),
        );
      }
    } catch (error) {
      this.logger.warn(
        `Reports dashboard cache invalidation failed (userId=${userId}): ${String(error)}`,
      );
    }
  }
}
