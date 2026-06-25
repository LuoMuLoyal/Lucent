import { formatDateOnly } from '../../../common/utils/date-time.utils';
import { Injectable } from '@nestjs/common';
import type { ReportDashboardDataDto, ReportDashboardQueryDto } from '../dto';
import { ReportsComputationService } from './reports-computation.service';
import { ReportsContextService } from './reports-context.service';

@Injectable()
export class ReportsService {
  constructor(
    private readonly contextService: ReportsContextService,
    private readonly computationService: ReportsComputationService,
  ) {}

  async getDashboard(
    userId: string,
    query: ReportDashboardQueryDto,
    locale: string,
  ): Promise<ReportDashboardDataDto> {
    const facts = await this.contextService.build(userId, query);
    const computed = this.computationService.compute(facts, locale);

    return {
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
  }
}
