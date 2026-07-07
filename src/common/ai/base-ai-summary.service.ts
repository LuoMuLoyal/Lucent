import { Injectable, Logger } from '@nestjs/common';
import { AI_SUMMARIES_ENABLED_SETTING_KEY } from '../constants/user-setting-keys';
import { forbidden } from '../helpers/api-errors';
import { PrismaService } from '../../prisma/prisma.service';
import type { PromptCopy } from '../helpers/localized-copy';
import type { StreamSummaryEvent } from '../api/stream-summary';
import { AiSafetyPolicyService } from './ai-safety-policy.service';
import { BaseAiGeneratorService } from './base-ai-generator.service';
import { extractErrorInfo } from '../helpers/error-info.utils';

export interface AiSummaryCopyService<TContext, TOutput> {
  resolveLocale(language: string | undefined): string;
  buildPromptCopy(locale: string): PromptCopy;
  summariesDisabled(locale: string): string;
  buildFallback(context: TContext, locale: string): TOutput;
}

export interface PreparedAiSummary<TContext, TMetadata = unknown> {
  context: TContext;
  locale: string;
  metadata?: TMetadata;
}

export interface AiStructuredOutput extends Record<string, unknown> {
  summary: string;
  bullets: Array<{ text: string }>;
  actionLabel: string;
  action: string;
  confidenceNote: string;
}

/**
 * Shared orchestration layer for AI summary features (today, report, etc.).
 *
 * Subclasses provide data preparation, DTO mapping, persistence, and any
 * post-processing hooks; the common generate / generateStream / fallback /
 * safety-check flow lives here.
 */
@Injectable()
export abstract class BaseAiSummaryService<
  TContext,
  TOutput extends AiStructuredOutput,
  TDataDto,
  TGenerateDto,
  TMetadata = unknown,
> {
  protected abstract readonly logger: Logger;

  protected constructor(
    protected readonly prisma: PrismaService,
    protected readonly copyService: AiSummaryCopyService<TContext, TOutput>,
    protected readonly generatorService: BaseAiGeneratorService<
      TContext,
      PromptCopy,
      TOutput
    >,
    protected readonly policyService: AiSafetyPolicyService,
  ) {}

  async generate(
    userId: string,
    dto: TGenerateDto,
    language: string,
  ): Promise<TDataDto> {
    const locale = this.copyService.resolveLocale(language);
    await this.assertAiSummariesEnabled(userId, locale);
    const prepared = await this.prepare(userId, dto, locale);
    const output = await this.generateStructuredOutput(
      prepared.context,
      prepared.locale,
    );
    const data = this.toDataDto(
      prepared.context,
      output,
      prepared.metadata as TMetadata,
    );
    await this.persistSummary(userId, data);
    await this.afterPersist(userId, data);
    return data;
  }

  async generateStream(
    userId: string,
    dto: TGenerateDto,
    language: string,
    onSummary: (event: StreamSummaryEvent) => void | Promise<void>,
  ): Promise<TDataDto> {
    const locale = this.copyService.resolveLocale(language);
    await this.assertAiSummariesEnabled(userId, locale);
    const prepared = await this.prepare(userId, dto, locale);
    const output = await this.generateStructuredOutputStream(
      prepared.context,
      prepared.locale,
      onSummary,
    );
    const data = this.toDataDto(
      prepared.context,
      output,
      prepared.metadata as TMetadata,
    );
    await this.persistSummary(userId, data);
    await this.afterPersist(userId, data);
    return data;
  }

  protected abstract prepare(
    userId: string,
    dto: TGenerateDto,
    locale: string,
  ): Promise<PreparedAiSummary<TContext, TMetadata>>;

  protected abstract toDataDto(
    context: TContext,
    output: TOutput,
    metadata: TMetadata,
  ): TDataDto;

  protected abstract persistSummary(
    userId: string,
    data: TDataDto,
  ): Promise<void>;

  protected abstract buildLogContext(context: TContext): string;

  private extractTexts(output: TOutput): string[] {
    return [output.summary, ...output.bullets.map((bullet) => bullet.text)];
  }

  protected async afterPersist(
    _userId: string,
    _data: TDataDto,
  ): Promise<void> {
    // Optional hook for notifications / side effects.
  }

  private async assertAiSummariesEnabled(
    userId: string,
    locale: string,
  ): Promise<void> {
    const setting = await this.prisma.userSetting.findFirst({
      where: {
        userId,
        key: AI_SUMMARIES_ENABLED_SETTING_KEY,
      },
      select: {
        value: true,
      },
    });

    if (setting?.value === false) {
      forbidden(this.copyService.summariesDisabled(locale));
    }
  }

  private async generateStructuredOutput(
    context: TContext,
    locale: string,
  ): Promise<TOutput> {
    if (!this.generatorService.hasAnalysisModel()) {
      this.logger.warn(
        `Model is not configured for ${this.buildLogContext(context)}; falling back`,
      );
      return this.copyService.buildFallback(context, locale);
    }

    try {
      const raw = await this.generatorService.generate(
        context,
        this.copyService.buildPromptCopy(locale),
      );
      if (this.policyService.isSafe(this.extractTexts(raw))) {
        return raw;
      }

      this.logger.warn(
        `Policy rejected model output for ${this.buildLogContext(context)}; falling back`,
      );
    } catch (error) {
      const { message: reason } = extractErrorInfo(error);
      this.logger.warn(
        `Generation failed for ${this.buildLogContext(context)}; falling back: ${reason}`,
      );
    }

    return this.copyService.buildFallback(context, locale);
  }

  private async generateStructuredOutputStream(
    context: TContext,
    locale: string,
    onSummary: (event: StreamSummaryEvent) => void | Promise<void>,
  ): Promise<TOutput> {
    if (!this.generatorService.hasAnalysisModel()) {
      this.logger.warn(
        `Model is not configured for ${this.buildLogContext(context)}; falling back`,
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

      if (this.policyService.isSafe(this.extractTexts(raw))) {
        await this.emitGuaranteedSummary(
          raw.summary,
          emittedSummary,
          onSummary,
        );
        return raw;
      }

      this.logger.warn(
        `Policy rejected streamed model output for ${this.buildLogContext(context)}; falling back`,
      );
    } catch (error) {
      const { message: reason } = extractErrorInfo(error);
      this.logger.warn(
        `Streamed generation failed for ${this.buildLogContext(context)}; falling back: ${reason}`,
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
}
