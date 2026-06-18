import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ResultCode } from '../../../common/api-envelope';
import { AiSummaryHistoryService } from '../../ai-chat/ai-summary-history.service';
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
import type { ReportSummaryStructuredOutput } from '../schemas/report-summary.schema';
import type { StreamSummaryEvent } from '../../../common/stream-summary';
import { USER_SETTING_KEYS } from '../../user-settings/user-settings.constants';

interface PreparedReportSummary {
  locale: string;
  context: ReportsAiSummaryContext;
}

@Injectable()
export class ReportsAiSummaryService {
  private readonly logger = new Logger(ReportsAiSummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiSummaryHistoryService: AiSummaryHistoryService,
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
    const prepared = await this.prepare(userId, dto, language);
    const output = await this.generateStructuredOutput(
      prepared.context,
      prepared.locale,
    );
    const data = this.toDataDto(prepared.context, output);
    await this.persistSummary(userId, data);
    return data;
  }

  async generateStream(
    userId: string,
    dto: GenerateReportSummaryDto,
    language: string,
    onSummary: (event: StreamSummaryEvent) => void | Promise<void>,
  ): Promise<ReportSummaryDataDto> {
    const prepared = await this.prepare(userId, dto, language);
    const output = await this.generateStructuredOutputStream(
      prepared.context,
      prepared.locale,
      onSummary,
    );
    const data = this.toDataDto(prepared.context, output);
    await this.persistSummary(userId, data);
    return data;
  }

  private async assertAiSummariesEnabled(
    userId: string,
    locale: string,
  ): Promise<void> {
    const setting = await this.prisma.userSetting.findFirst({
      where: {
        userId,
        key: USER_SETTING_KEYS.aiSummariesEnabled,
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
    if (!this.reportsAiSummaryGeneratorService.hasAnalysisModel()) {
      this.logger.warn(
        `Report summary model is not configured for ${context.startDate}..${context.endDate}; falling back`,
      );
      return this.reportsAiSummaryCopyService.buildFallback(context, locale);
    }

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

  private async generateStructuredOutputStream(
    context: ReportsAiSummaryContext,
    locale: string,
    onSummary: (event: StreamSummaryEvent) => void | Promise<void>,
  ): Promise<ReportSummaryStructuredOutput> {
    if (!this.reportsAiSummaryGeneratorService.hasAnalysisModel()) {
      this.logger.warn(
        `Report summary model is not configured for ${context.startDate}..${context.endDate}; falling back`,
      );
      const fallback = this.reportsAiSummaryCopyService.buildFallback(
        context,
        locale,
      );
      await this.emitGuaranteedSummary(fallback.summary, false, onSummary);
      return fallback;
    }

    let emittedSummary = false;

    try {
      const raw = await this.reportsAiSummaryGeneratorService.generateStream(
        context,
        this.reportsAiSummaryCopyService.buildPromptCopy(locale),
        async (summary) => {
          if (!this.reportsAiSummaryPolicyService.isSafeSummaryText(summary)) {
            return;
          }
          emittedSummary = true;
          await onSummary({ summary });
        },
      );

      if (this.reportsAiSummaryPolicyService.isSafe(raw)) {
        await this.emitGuaranteedSummary(
          raw.summary,
          emittedSummary,
          onSummary,
        );
        return raw;
      }

      this.logger.warn(
        `Report summary policy rejected streamed model output for ${context.startDate}..${context.endDate}; falling back`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Report summary streamed generation failed for ${context.startDate}..${context.endDate}; falling back: ${reason}`,
      );
    }

    const fallback = this.reportsAiSummaryCopyService.buildFallback(
      context,
      locale,
    );
    await this.emitGuaranteedSummary(
      fallback.summary,
      emittedSummary,
      onSummary,
    );
    return fallback;
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

  private async prepare(
    userId: string,
    dto: GenerateReportSummaryDto,
    language: string,
  ): Promise<PreparedReportSummary> {
    const locale = this.reportsAiSummaryCopyService.resolveLocale(language);
    await this.assertAiSummariesEnabled(userId, locale);

    const query: ReportDashboardQueryDto =
      dto.range === undefined ? {} : { range: dto.range };
    const facts = await this.reportsContextService.build(userId, query);
    const computed = this.reportsComputationService.compute(facts, locale);
    const context = this.reportsAiSummaryContextService.build(facts, computed);

    return {
      locale,
      context,
    };
  }

  private async emitGuaranteedSummary(
    summary: string,
    alreadyEmitted: boolean,
    onSummary: (event: StreamSummaryEvent) => void | Promise<void>,
  ): Promise<void> {
    if (alreadyEmitted || summary.trim().length == 0) {
      return;
    }

    await onSummary({ summary });
  }

  private toDataDto(
    context: ReportsAiSummaryContext,
    output: ReportSummaryStructuredOutput,
  ): ReportSummaryDataDto {
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

  private async persistSummary(
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
      confidenceNote: data.confidenceNote,
    });
  }
}
