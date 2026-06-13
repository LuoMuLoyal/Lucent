import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ResultCode } from '../../../common/api-envelope';
import { PrismaService } from '../../../prisma/prisma.service';
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
import { ReportsAiSummaryPolicyService } from './reports-ai-summary-policy.service';
import { ReportsComputationService } from '../dashboard/reports-computation.service';
import { ReportsContextService } from '../dashboard/reports-context.service';
import type { ReportSummaryStructuredOutput } from './report-summary.schema';

@Injectable()
export class ReportsAiSummaryService {
  private readonly logger = new Logger(ReportsAiSummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reportsContextService: ReportsContextService,
    private readonly reportsComputationService: ReportsComputationService,
    private readonly reportsAiSummaryContextService: ReportsAiSummaryContextService,
    private readonly reportsAiSummaryCopyService: ReportsAiSummaryCopyService,
    private readonly reportsAiSummaryGeneratorService: ReportsAiSummaryGeneratorService,
    private readonly reportsAiSummaryPolicyService: ReportsAiSummaryPolicyService,
  ) {}

  async generate(
    userId: string,
    dto: GenerateReportSummaryDto,
    language: string,
  ): Promise<ReportSummaryDataDto> {
    const locale = this.reportsAiSummaryCopyService.resolveLocale(language);
    await this.assertAiSummariesEnabled(userId, locale);

    const query: ReportDashboardQueryDto =
      dto.range === undefined ? {} : { range: dto.range };
    const facts = await this.reportsContextService.build(userId, query);
    const computed = this.reportsComputationService.compute(facts, locale);
    const context = this.reportsAiSummaryContextService.build(facts, computed);

    if (!this.reportsAiSummaryGeneratorService.hasAnalysisModel()) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.reportsAiSummaryCopyService.serviceUnavailable(locale),
      });
    }

    const output = await this.generateStructuredOutput(context, locale);

    return {
      range: context.range,
      startDate: context.startDate,
      endDate: context.endDate,
      generatedAt: context.generatedAt,
      summary: output.summary,
      bullets: output.bullets,
      actionLabel: output.actionLabel,
      confidenceNote: output.confidenceNote,
    };
  }

  private async assertAiSummariesEnabled(
    userId: string,
    locale: string,
  ): Promise<void> {
    const setting = await this.prisma.userSetting.findFirst({
      where: {
        userId,
        key: 'aiSummariesEnabled',
      },
      select: {
        value: true,
      },
    });

    if (setting?.value === false) {
      throw new ForbiddenException({
        code: ResultCode.FORBIDDEN,
        message: this.reportsAiSummaryCopyService.summariesDisabled(locale),
      });
    }
  }

  private async generateStructuredOutput(
    context: ReportsAiSummaryContext,
    locale: string,
  ): Promise<ReportSummaryStructuredOutput> {
    try {
      const raw = await this.invokeModel(context, locale);
      if (this.reportsAiSummaryPolicyService.isSafe(raw)) {
        return raw;
      }

      this.logger.warn(
        `Report summary policy rejected model output for ${context.startDate}..${context.endDate}; falling back`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Report summary generation failed for ${context.startDate}..${context.endDate}; falling back: ${reason}`,
      );
    }

    return this.reportsAiSummaryCopyService.buildFallback(context, locale);
  }

  private async invokeModel(
    context: ReportsAiSummaryContext,
    locale: string,
  ): Promise<ReportSummaryStructuredOutput> {
    return this.reportsAiSummaryGeneratorService.generate(
      context,
      this.reportsAiSummaryCopyService.buildPromptCopy(locale),
    );
  }
}
