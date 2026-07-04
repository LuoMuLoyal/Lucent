import { Injectable, Logger } from '@nestjs/common';
import { badRequest } from '../../../common/helpers/api-errors';

import { HistoricalAiSummaryService } from '../../assistant/services/historical-ai-summary.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { BaseAiSummaryService } from '../../../common/ai/base-ai-summary.service';
import { AiSafetyPolicyService } from '../../../common/ai/ai-safety-policy.service';
import type {
  GenerateReportSummaryDto,
  ReportDashboardQueryDto,
  ReportSummaryDataDto,
} from '../dto';
import {
  ReportsAiSummaryContextService,
  type ReportsAiSummaryContext,
} from './reports-ai-summary-context.service';
import { ReportsAiSummaryCopyService } from './reports-ai-summary-copy.service';
import { ReportsAiSummaryGeneratorService } from './reports-ai-summary-generator.service';
import type { ReportSummaryStructuredOutput } from '../schemas/report-summary.schema';
import { ReportsComputationService } from '../dashboard/reports-computation.service';
import { ReportsContextService } from '../dashboard/reports-context.service';

interface PreparedReportSummary {
  context: ReportsAiSummaryContext;
  locale: string;
}

@Injectable()
export class ReportsAiSummaryService extends BaseAiSummaryService<
  ReportsAiSummaryContext,
  ReportSummaryStructuredOutput,
  ReportSummaryDataDto,
  GenerateReportSummaryDto
> {
  protected readonly logger = new Logger(ReportsAiSummaryService.name);

  constructor(
    prisma: PrismaService,
    private readonly aiSummaryHistoryService: HistoricalAiSummaryService,
    private readonly reportsContextService: ReportsContextService,
    private readonly reportsComputationService: ReportsComputationService,
    private readonly reportsAiSummaryContextService: ReportsAiSummaryContextService,
    reportsAiSummaryCopyService: ReportsAiSummaryCopyService,
    reportsAiSummaryGeneratorService: ReportsAiSummaryGeneratorService,
    reportsAiSummaryPolicyService: AiSafetyPolicyService,
  ) {
    super(
      prisma,
      reportsAiSummaryCopyService,
      reportsAiSummaryGeneratorService,
      reportsAiSummaryPolicyService,
    );
  }

  protected async prepare(
    userId: string,
    dto: GenerateReportSummaryDto,
    locale: string,
  ): Promise<PreparedReportSummary> {
    const query: ReportDashboardQueryDto = this.toDashboardQuery(dto);
    const facts = await this.reportsContextService.build(userId, query);
    const computed = this.reportsComputationService.compute(facts, locale);
    const context = this.reportsAiSummaryContextService.build(facts, computed);

    return {
      locale,
      context,
    };
  }

  protected toDataDto(
    context: ReportsAiSummaryContext,
    output: ReportSummaryStructuredOutput,
    _metadata: unknown,
  ): ReportSummaryDataDto {
    return {
      range: context.range,
      startDate: context.startDate,
      endDate: context.endDate,
      generatedAt: context.generatedAt,
      summary: output.summary,
      bullets: output.bullets,
      actionLabel: output.actionLabel,
      action: output.action,
      confidenceNote: output.confidenceNote,
    };
  }

  protected async persistSummary(
    userId: string,
    data: ReportSummaryDataDto,
  ): Promise<void> {
    await this.aiSummaryHistoryService.save({
      userId,
      kind: 'report',
      scopeKey: `report:${data.range}:${data.startDate}:${data.endDate}`,
      rangeKey: data.range,
      startDate: data.startDate,
      endDate: data.endDate,
      generatedAt: data.generatedAt,
      summary: data.summary,
      bullets: data.bullets,
      actionLabel: data.actionLabel,
      action: data.action,
      confidenceNote: data.confidenceNote,
    });
  }

  protected buildLogContext(context: ReportsAiSummaryContext): string {
    return `${context.startDate}..${context.endDate}`;
  }

  private toDashboardQuery(
    dto: GenerateReportSummaryDto,
  ): ReportDashboardQueryDto {
    if (dto.range === undefined) {
      return {};
    }
    if (dto.range === 'custom') {
      if (dto.startDate == null || dto.endDate == null) {
        badRequest(
          'startDate and endDate are required for custom range summaries.',
        );
      }
      return {
        range: dto.range,
        startDate: dto.startDate,
        endDate: dto.endDate,
      };
    }
    return { range: dto.range };
  }
}
