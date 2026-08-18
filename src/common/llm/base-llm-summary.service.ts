import { Injectable, Logger } from '@nestjs/common';
import { AI_SUMMARIES_ENABLED_SETTING_KEY } from '../constants/user-setting-keys';
import { forbidden } from '../helpers/errors/api-errors';
import { PrismaService } from '../../prisma';
import type { PromptCopy } from '../helpers/format/localized-copy';
import type { StreamSummaryEvent } from '../api/stream-summary';
import { LlmSafetyPolicyService } from './llm-safety-policy.service';
import { BaseLlmGeneratorService } from './base-llm-generator.service';
import { extractErrorInfo } from '../helpers/errors/error-info.utils';

export interface LlmSummaryCopyService<TContext, TOutput> {
  resolveLocale(language: string | undefined): string;
  buildPromptCopy(locale: string): PromptCopy;
  summariesDisabled(locale: string): string;
  buildFallback(context: TContext, locale: string): TOutput;
}

export interface PreparedLlmSummary<TContext, TMetadata = unknown> {
  context: TContext;
  locale: string;
  metadata?: TMetadata;
}

export interface LlmStructuredOutput extends Record<string, unknown> {
  summary: string;
  bullets?: Array<{ text: string }>;
  actionLabel?: string;
  action?: string;
  confidenceNote?: string;
}

/**
 * Shared orchestration layer for LLM summary features (today, report, etc.).
 *
 * Subclasses provide data preparation, DTO mapping, persistence, and any
 * post-processing hooks; the common generate / generateStream / fallback /
 * safety-check flow lives here.
 */
@Injectable()
export abstract class BaseLlmSummaryService<
  TContext,
  TOutput extends LlmStructuredOutput,
  TDataDto,
  TGenerateDto,
  TMetadata = unknown,
> {
  protected abstract readonly logger: Logger;

  protected constructor(
    protected readonly prisma: PrismaService,
    protected readonly copyService: LlmSummaryCopyService<TContext, TOutput>,
    protected readonly generatorService: BaseLlmGeneratorService<
      TContext,
      PromptCopy,
      TOutput
    >,
    protected readonly policyService: LlmSafetyPolicyService,
  ) {}

  async generate(
    userId: string,
    dto: TGenerateDto,
    language: string,
  ): Promise<TDataDto> {
    const locale = this.copyService.resolveLocale(language);
    await this.assertAiSummariesEnabled(userId, locale);
    const prepared = await this.prepare(userId, dto, locale);
    const { output, aiGenerated } = await this.generateStructuredOutput(
      prepared.context,
      prepared.locale,
    );
    const data = this.toDataDto(
      prepared.context,
      output,
      prepared.metadata as TMetadata,
      aiGenerated,
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
    const { output, aiGenerated } = await this.generateStructuredOutputStream(
      prepared.context,
      prepared.locale,
      onSummary,
    );
    const data = this.toDataDto(
      prepared.context,
      output,
      prepared.metadata as TMetadata,
      aiGenerated,
    );
    await this.persistSummary(userId, data);
    await this.afterPersist(userId, data);
    return data;
  }

  protected abstract prepare(
    userId: string,
    dto: TGenerateDto,
    locale: string,
  ): Promise<PreparedLlmSummary<TContext, TMetadata>>;

  protected abstract toDataDto(
    context: TContext,
    output: TOutput,
    metadata: TMetadata,
    aiGenerated: boolean,
  ): TDataDto;

  protected abstract persistSummary(
    userId: string,
    data: TDataDto,
  ): Promise<void>;

  protected abstract buildLogContext(context: TContext): string;

  private extractTexts(output: TOutput): string[] {
    const texts: string[] = [output.summary];
    if (output.bullets != null) {
      texts.push(...output.bullets.map((bullet) => bullet.text));
    }
    if (output.actionLabel != null) {
      texts.push(output.actionLabel);
    }
    if (output.action != null) {
      texts.push(output.action);
    }
    if (output.confidenceNote != null) {
      texts.push(output.confidenceNote);
    }
    return texts;
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
  ): Promise<{ output: TOutput; aiGenerated: boolean }> {
    if (!this.generatorService.hasAnalysisModel()) {
      this.logger.warn(
        `Model is not configured for ${this.buildLogContext(context)}; falling back`,
      );
      return {
        output: this.copyService.buildFallback(context, locale),
        aiGenerated: false,
      };
    }

    try {
      const raw = await this.generatorService.generate(
        context,
        this.copyService.buildPromptCopy(locale),
      );
      if (this.policyService.isSafe(this.extractTexts(raw))) {
        return { output: raw, aiGenerated: true };
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

    return {
      output: this.copyService.buildFallback(context, locale),
      aiGenerated: false,
    };
  }

  private async generateStructuredOutputStream(
    context: TContext,
    locale: string,
    onSummary: (event: StreamSummaryEvent) => void | Promise<void>,
  ): Promise<{ output: TOutput; aiGenerated: boolean }> {
    if (!this.generatorService.hasAnalysisModel()) {
      this.logger.warn(
        `Model is not configured for ${this.buildLogContext(context)}; falling back`,
      );
      const fallback = this.copyService.buildFallback(context, locale);
      await this.emitGuaranteedSummary(fallback.summary, false, onSummary);
      return { output: fallback, aiGenerated: false };
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
        return { output: raw, aiGenerated: true };
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
    return { output: fallback, aiGenerated: false };
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
