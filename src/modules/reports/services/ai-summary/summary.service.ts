import { Injectable, Logger } from '@nestjs/common';
import { badRequest } from '../../../../common';

import { HistoricalAiSummaryService } from '../../../assistant';
import { PrismaService } from '../../../../prisma';
import { BaseLlmSummaryService } from '../../../../common/llm/base-llm-summary.service';
import { LlmSafetyPolicyService } from '../../../../common/llm/llm-safety-policy.service';
import type { GenerateReportSummaryDto } from '../../dto/generate-report-summary.dto';

import type { ReportDashboardQueryDto } from '../../dto/report-dashboard-query.dto';

import type { ReportSummaryDataDto } from '../../dto/report-summary-response.dto';
import {
  ReportsAiSummaryContextService,
  type ReportsAiSummaryContext,
} from './context.service';
import { ReportsLlmSummaryCopyService } from './copy.service';
import { ReportsAiSummaryGeneratorService } from './generator.service';
import type { ReportSummaryStructuredOutput } from '../../schemas/report-summary.schema';
import { ReportsComputationService } from '../../dashboard/computation.service';
import { ReportsContextService } from '../../dashboard/context.service';

interface PreparedReportSummary {
  context: ReportsAiSummaryContext;
  locale: string;
}

@Injectable()
export class ReportsAiSummaryService extends BaseLlmSummaryService<
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
    reportsLlmSummaryCopyService: ReportsLlmSummaryCopyService,
    reportsAiSummaryGeneratorService: ReportsAiSummaryGeneratorService,
    reportsAiSummaryPolicyService: LlmSafetyPolicyService,
  ) {
    super(
      prisma,
      reportsLlmSummaryCopyService,
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
    _aiGenerated: boolean,
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
