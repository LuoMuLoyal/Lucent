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
    const cacheKey = `reports:dashboard:${userId}:${range}:${query.startDate ?? 'auto'}:${query.endDate ?? 'auto'}:${locale}`;

    const cached = await this.cache.get<ReportDashboardDataDto>(cacheKey);
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
      score: computed.score,
      metrics: computed.metrics,
      trends: computed.trends,
      findings: computed.findings,
      patterns: computed.patterns,
      aiSummaryEnabled: facts.aiSummaryEnabled,
    };

    await this.cache.set(cacheKey, result, ReportsService.CACHE_TTL_MS);
    this.logger.debug(
      `Cache set: dashboard (userId=${userId}, key=${cacheKey})`,
    );
    return result;
  }
}
