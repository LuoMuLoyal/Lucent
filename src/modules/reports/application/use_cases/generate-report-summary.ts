import { Injectable, Inject, Logger } from '@nestjs/common';
import { createDomainFailure } from '../../../../common/result/index.js';
import { DomainFailureException } from '../../../../common/result/domain-failure.exception.js';

import { HistoricalAiSummaryService } from '../../../assistant/index.js';
import { IUserSettingsPort } from '../../../user-settings/index.js';
import { BaseLlmSummaryService } from '../../../../common/llm/generators/base-llm-summary.service.js';
import { LlmSafetyPolicyService } from '../../../../common/llm/safety/llm-safety-policy.service.js';
import type { PromptCopy } from '../../../../common/index.js';
import type { GenerateReportSummaryDto } from '../../application/use_cases/generate-report-summary-command.js';

import { REPORT_DASHBOARD_CONTEXT } from '../ports/dashboard.js';
import type {
  DashboardContextPort,
  ReportDashboardQuery,
} from '../ports/dashboard.js';
import type { ReportSummaryDataDto } from '../../application/read_models/report-summary-response.js';
import {
  ReportsAiSummaryContextService,
  type ReportsAiSummaryContext,
} from '../read_models/ai-summary/summary-context.js';
import { ReportsLlmSummaryCopyService } from '../services/summary-copy.js';
import {
  REPORT_SUMMARY_GENERATOR,
  type SummaryGeneratorContract,
} from '../ports/summary.js';
import type { ReportSummaryStructuredOutput } from '../ports/report-summary-output.js';
import { ReportsComputationService } from '../read_models/dashboard/dashboard-computation.js';

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
    private readonly userSettings: IUserSettingsPort,
    private readonly aiSummaryHistoryService: HistoricalAiSummaryService,
    @Inject(REPORT_DASHBOARD_CONTEXT)
    private readonly reportsContextService: DashboardContextPort,
    private readonly reportsComputationService: ReportsComputationService,
    private readonly reportsAiSummaryContextService: ReportsAiSummaryContextService,
    reportsLlmSummaryCopyService: ReportsLlmSummaryCopyService,
    @Inject(REPORT_SUMMARY_GENERATOR)
    reportsAiSummaryGeneratorService: SummaryGeneratorContract<
      ReportsAiSummaryContext,
      PromptCopy,
      ReportSummaryStructuredOutput
    >,
    reportsAiSummaryPolicyService: LlmSafetyPolicyService,
  ) {
    super(
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
    const query: ReportDashboardQuery = this.toDashboardQuery(dto);
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
    await this.aiSummaryHistoryService.save({
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
    });
  }

  /**
   * Template-method hook the base class asks about before generating.
   *
   * Reads through `IUserSettingsPort` rather than own Prisma: the setting is
   * `user-settings`' data, and reaching into its table from `reports` would be
   * a cross-context read outside ADR-0009 — invisible to the dependency rules
   * (a Prisma call is not an import) but still a boundary violation.
   */
  protected async isAiSummariesEnabled(userId: string): Promise<boolean> {
    const settings = await this.userSettings.getSettings(userId);
    return settings.aiSummariesEnabled;
  }

  protected buildLogContext(context: ReportsAiSummaryContext): string {
    return `${context.startDate}..${context.endDate}`;
  }

  /**
   * Rejects a malformed summary request with the registered validation detail.
   *
   * `direction` is logged, never sent: an explicit `detail` overrides the
   * registry's translated copy, so the previous English sentence bypassed it
   * for every locale.
   */
  private validationFailed(direction: 'custom_range_dates_required'): never {
    this.logger.warn(`Report AI summary request rejected (${direction})`);
    throw new DomainFailureException(
      createDomainFailure({
        kind: 'validation',
        code: 'VALIDATION_FAILED',
      }),
    );
  }

  private toDashboardQuery(
    dto: GenerateReportSummaryDto,
  ): ReportDashboardQuery {
    if (dto.range === undefined) {
      return {};
    }
    if (dto.range === 'custom') {
      if (dto.startDate == null || dto.endDate == null) {
        this.validationFailed('custom_range_dates_required');
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
