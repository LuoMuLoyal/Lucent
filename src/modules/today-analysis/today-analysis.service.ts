import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { I18nService } from 'nestjs-i18n';
import { ResultCode } from '../../common/api-envelope';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmRuntimeService } from '../llm-runtime/llm-runtime.service';
import type { GenerateTodayAnalysisDto, TodayAnalysisDataDto } from './dto';
import {
  buildTodayAnalysisSystemPrompt,
  buildTodayAnalysisUserPrompt,
  type TodayAnalysisPromptCopy,
} from './prompts/today-analysis.prompt';
import {
  todayAnalysisSchema,
  type TodayAnalysisStructuredOutput,
} from './schemas/today-analysis.schema';
import {
  TodayAnalysisContextService,
  type TodayAnalysisContext,
} from './today-analysis-context.service';
import { TodayAnalysisPolicyService } from './today-analysis-policy.service';

@Injectable()
export class TodayAnalysisService {
  private readonly logger = new Logger(TodayAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contextService: TodayAnalysisContextService,
    private readonly policyService: TodayAnalysisPolicyService,
    private readonly llmRuntimeService: LlmRuntimeService,
    private readonly i18n: I18nService,
  ) {}

  async generate(
    userId: string,
    dto: GenerateTodayAnalysisDto,
    language: string,
  ): Promise<TodayAnalysisDataDto> {
    await this.assertAiSummariesEnabled(userId);

    const date = dto.date ?? this.todayUtcDateString();
    const context = await this.contextService.build(userId, date);
    const generatedAt = new Date().toISOString();
    const locale = this.resolveLocale(language);

    if (!this.llmRuntimeService.hasRoleConfig('analysis')) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.i18n.t('today-analysis.service_unavailable', {
          lang: locale,
        }),
      });
    }

    const output = await this.generateStructuredOutput(context, locale);

    return {
      date,
      generatedAt,
      summary: output.summary,
      bullets: output.bullets,
      actionLabel: output.actionLabel,
      confidenceNote: output.confidenceNote,
    };
  }

  private async assertAiSummariesEnabled(userId: string): Promise<void> {
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
        message: this.i18n.t('today-analysis.summaries_disabled'),
      });
    }
  }

  private async generateStructuredOutput(
    context: TodayAnalysisContext,
    locale: string,
  ): Promise<TodayAnalysisStructuredOutput> {
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

    return this.buildFallback(context, locale);
  }

  private async invokeModel(
    context: TodayAnalysisContext,
    locale: string,
  ): Promise<TodayAnalysisStructuredOutput> {
    const promptCopy = this.buildPromptCopy(locale);
    const model = this.llmRuntimeService
      .createChatModel('analysis', {
        timeout: 10_000,
        temperature: 0.2,
        maxRetries: 0,
      })
      .withStructuredOutput(todayAnalysisSchema, {
        name: 'TodayAnalysis',
        method: 'functionCalling',
        strict: true,
      });

    return model.invoke([
      new SystemMessage(buildTodayAnalysisSystemPrompt()),
      new HumanMessage(buildTodayAnalysisUserPrompt(context, promptCopy)),
    ]);
  }

  private buildFallback(
    context: TodayAnalysisContext,
    locale: string,
  ): TodayAnalysisStructuredOutput {
    const medicationPending = context.medication.pendingCount;
    const waterRemaining = context.water.remainingCount;
    const actionLabel = this.i18n.t('today-analysis.fallback.action_label', {
      lang: locale,
    });
    const confidenceNote = this.i18n.t(
      'today-analysis.fallback.confidence_note',
      {
        lang: locale,
      },
    );

    let summary = this.i18n.t('today-analysis.fallback.summary_default', {
      lang: locale,
    });
    if (medicationPending > 0 && waterRemaining > 0) {
      summary = this.i18n.t(
        'today-analysis.fallback.summary_medication_and_hydration',
        {
          lang: locale,
          args: {
            medicationPending,
            waterRemaining,
          },
        },
      );
    } else if (medicationPending > 0) {
      summary = this.i18n.t('today-analysis.fallback.summary_medication_only', {
        lang: locale,
        args: {
          medicationPending,
        },
      });
    } else if (waterRemaining > 0) {
      summary = this.i18n.t('today-analysis.fallback.summary_hydration_only', {
        lang: locale,
        args: {
          waterRemaining,
        },
      });
    }

    return {
      summary,
      bullets: [
        {
          kind: 'medication',
          text:
            medicationPending > 0
              ? this.i18n.t(
                  'today-analysis.fallback.bullet_medication_pending',
                  {
                    lang: locale,
                    args: {
                      medicationPending,
                    },
                  },
                )
              : this.i18n.t('today-analysis.fallback.bullet_medication_done', {
                  lang: locale,
                }),
        },
        {
          kind: 'hydration',
          text:
            waterRemaining > 0
              ? this.i18n.t(
                  'today-analysis.fallback.bullet_hydration_pending',
                  {
                    lang: locale,
                    args: {
                      waterRemaining,
                    },
                  },
                )
              : this.i18n.t('today-analysis.fallback.bullet_hydration_done', {
                  lang: locale,
                }),
        },
        {
          kind: 'sleep',
          text: this.i18n.t('today-analysis.fallback.bullet_sleep_missing', {
            lang: locale,
          }),
        },
      ],
      actionLabel,
      confidenceNote,
    };
  }

  private buildPromptCopy(locale: string): TodayAnalysisPromptCopy {
    const actionLabel = this.i18n.t('today-analysis.fallback.action_label', {
      lang: locale,
    });
    const languageLabel = locale === 'zh-CN' ? '中文' : 'English';

    return {
      userIntro: this.i18n.t('today-analysis.prompt.user_intro', {
        lang: locale,
        args: {
          languageLabel,
        },
      }),
      tone: this.i18n.t('today-analysis.prompt.tone', {
        lang: locale,
      }),
      actionLabelHint: this.i18n.t('today-analysis.prompt.action_label_hint', {
        lang: locale,
        args: {
          actionLabel,
        },
      }),
      factsLabel: this.i18n.t('today-analysis.prompt.facts_label', {
        lang: locale,
      }),
    };
  }

  private resolveLocale(language: string | undefined): string {
    const normalized = language?.trim().toLowerCase() ?? '';
    if (normalized.startsWith('zh')) {
      return 'zh-CN';
    }
    return 'en';
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
