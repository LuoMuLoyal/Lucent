import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ResultCode } from '../../../common/api-envelope';
import { PrismaService } from '../../../prisma/prisma.service';
import type { GenerateTodayAnalysisDto, TodayAnalysisDataDto } from '../dto';
import { TodayAnalysisCopyService } from './today-analysis-copy.service';
import {
  TodayAnalysisContextService,
  type TodayAnalysisContext,
} from './today-analysis-context.service';
import { TodayAnalysisGeneratorService } from './today-analysis-generator.service';
import { TodayAnalysisPolicyService } from './today-analysis-policy.service';
import type { TodayAnalysisStructuredOutput } from './today-analysis.schema';
import type { StreamSummaryEvent } from '../../../common/stream-summary';
import { USER_SETTING_KEYS } from '../../user-settings/user-settings.constants';

interface PreparedTodayAnalysis {
  locale: string;
  context: TodayAnalysisContext;
  generatedAt: string;
}

@Injectable()
export class TodayAnalysisService {
  private readonly logger = new Logger(TodayAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contextService: TodayAnalysisContextService,
    private readonly policyService: TodayAnalysisPolicyService,
    private readonly copyService: TodayAnalysisCopyService,
    private readonly generatorService: TodayAnalysisGeneratorService,
  ) {}

  async generate(
    userId: string,
    dto: GenerateTodayAnalysisDto,
    language: string,
  ): Promise<TodayAnalysisDataDto> {
    const prepared = await this.prepare(userId, dto, language);
    const output = await this.generateStructuredOutput(
      prepared.context,
      prepared.locale,
    );

    return this.toDataDto(prepared, output);
  }

  async generateStream(
    userId: string,
    dto: GenerateTodayAnalysisDto,
    language: string,
    onSummary: (event: StreamSummaryEvent) => void | Promise<void>,
  ): Promise<TodayAnalysisDataDto> {
    const prepared = await this.prepare(userId, dto, language);
    const output = await this.generateStructuredOutputStream(
      prepared.context,
      prepared.locale,
      onSummary,
    );

    return this.toDataDto(prepared, output);
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
        message: this.copyService.summariesDisabled(locale),
      });
    }
  }

  private async generateStructuredOutput(
    context: TodayAnalysisContext,
    locale: string,
  ): Promise<TodayAnalysisStructuredOutput> {
    if (!this.generatorService.hasAnalysisModel()) {
      this.logger.warn(
        `Today analysis model is not configured for ${context.date}; falling back`,
      );
      return this.copyService.buildFallback(context, locale);
    }

    try {
      const raw = await this.invokeModel(context, locale);
      if (this.policyService.isSafe(raw)) {
        return raw;
      }

      this.logger.warn(
        `Today analysis policy rejected model output for ${context.date}; falling back`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Today analysis model generation failed for ${context.date}; falling back: ${reason}`,
      );
    }

    return this.copyService.buildFallback(context, locale);
  }

  private async generateStructuredOutputStream(
    context: TodayAnalysisContext,
    locale: string,
    onSummary: (event: StreamSummaryEvent) => void | Promise<void>,
  ): Promise<TodayAnalysisStructuredOutput> {
    if (!this.generatorService.hasAnalysisModel()) {
      this.logger.warn(
        `Today analysis model is not configured for ${context.date}; falling back`,
      );
      const fallback = this.copyService.buildFallback(context, locale);
      await this.emitGuaranteedSummary(fallback.summary, false, onSummary);
      return fallback;
    }

    let emittedSummary = false;

    try {
      const raw = await this.generatorService.generateStream(
        context,
        this.copyService.buildPromptCopy(locale),
        async (summary) => {
          if (!this.policyService.isSafeSummaryText(summary)) {
            return;
          }
          emittedSummary = true;
          await onSummary({ summary });
        },
      );

      if (this.policyService.isSafe(raw)) {
        await this.emitGuaranteedSummary(
          raw.summary,
          emittedSummary,
          onSummary,
        );
        return raw;
      }

      this.logger.warn(
        `Today analysis policy rejected streamed model output for ${context.date}; falling back`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Today analysis streamed generation failed for ${context.date}; falling back: ${reason}`,
      );
    }

    const fallback = this.copyService.buildFallback(context, locale);
    await this.emitGuaranteedSummary(
      fallback.summary,
      emittedSummary,
      onSummary,
    );
    return fallback;
  }

  private async invokeModel(
    context: TodayAnalysisContext,
    locale: string,
  ): Promise<TodayAnalysisStructuredOutput> {
    return this.generatorService.generate(
      context,
      this.copyService.buildPromptCopy(locale),
    );
  }

  private async prepare(
    userId: string,
    dto: GenerateTodayAnalysisDto,
    language: string,
  ): Promise<PreparedTodayAnalysis> {
    const locale = this.copyService.resolveLocale(language);
    await this.assertAiSummariesEnabled(userId, locale);

    const date = dto.date ?? this.todayUtcDateString();
    const context = await this.contextService.build(userId, date);
    const generatedAt = new Date().toISOString();

    return {
      locale,
      context,
      generatedAt,
    };
  }

  private async emitGuaranteedSummary(
    summary: string,
    alreadyEmitted: boolean,
    onSummary: (event: StreamSummaryEvent) => void | Promise<void>,
  ): Promise<void> {
    if (alreadyEmitted || summary.trim().length === 0) {
      return;
    }

    await onSummary({ summary });
  }

  private toDataDto(
    prepared: PreparedTodayAnalysis,
    output: TodayAnalysisStructuredOutput,
  ): TodayAnalysisDataDto {
    return {
      date: prepared.context.date,
      generatedAt: prepared.generatedAt,
      summary: output.summary,
      bullets: output.bullets,
      actionLabel: output.actionLabel,
      confidenceNote: output.confidenceNote,
    };
  }

  private todayUtcDateString(): string {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    )
      .toISOString()
      .slice(0, 10);
  }
}
