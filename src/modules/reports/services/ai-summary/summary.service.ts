import { Injectable, Logger } from '@nestjs/common';
import {
  createDomainFailure,
  unwrapResult,
} from '../../../../common/result/index.js';
import { DomainFailureException } from '../../../../common/result/domain-failure.exception.js';

import { HistoricalAiSummaryService } from '../../../assistant/index.js';
import { PrismaService } from '../../../../prisma/index.js';
import { BaseLlmSummaryService } from '../../../../common/llm/generators/base-llm-summary.service.js';
import { LlmSafetyPolicyService } from '../../../../common/llm/safety/llm-safety-policy.service.js';
import type { GenerateReportSummaryDto } from '../../dto/generate-report-summary.dto.js';

import type { ReportDashboardQueryDto } from '../../dto/report-dashboard-query.dto.js';

import type { ReportSummaryDataDto } from '../../dto/report-summary-response.dto.js';
import {
  ReportsAiSummaryContextService,
  type ReportsAiSummaryContext,
} from './context.service.js';
import { ReportsLlmSummaryCopyService } from './copy.service.js';
import { ReportsAiSummaryGeneratorService } from './generator.service.js';
import type { ReportSummaryStructuredOutput } from '../../schemas/report-summary.schema.js';
import { ReportsComputationService } from '../../dashboard/computation.service.js';
import { ReportsContextService } from '../../dashboard/context.service.js';

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
      coverage: {
        medication: context.coverage.medication,
        water: context.coverage.water,
        sleep: context.coverage.sleep,
      },
      observedPattern: output.observedPattern,
      lowRiskAction: output.lowRiskAction,
      disclaimer: output.disclaimer,
    };
  }

  protected async persistSummary(
    userId: string,
    data: ReportSummaryDataDto,
  ): Promise<void> {
    await unwrapResult(
      this.aiSummaryHistoryService.save({
        userId,
        kind: 'report',
        scopeKey: `report:${data.range}:${data.startDate}:${data.endDate}`,
        rangeKey: data.range,
        startDate: data.startDate,
        endDate: data.endDate,
        generatedAt: data.generatedAt,
        summary: data.summary,
        coverage: data.coverage,
        observedPattern: data.observedPattern,
        lowRiskAction: data.lowRiskAction,
        disclaimer: data.disclaimer,
      }),
    );
  }

  protected buildLogContext(context: ReportsAiSummaryContext): string {
    return `${context.startDate}..${context.endDate}`;
  }

  private validationFailed(message: string): never {
    throw new DomainFailureException(
      createDomainFailure({
        kind: 'validation',
        code: 'VALIDATION_FAILED',
        detail: message,
      }),
    );
  }

  private toDashboardQuery(
    dto: GenerateReportSummaryDto,
  ): ReportDashboardQueryDto {
    if (dto.range === undefined) {
      return {};
    }
    if (dto.range === 'custom') {
      if (dto.startDate == null || dto.endDate == null) {
        this.validationFailed(
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
