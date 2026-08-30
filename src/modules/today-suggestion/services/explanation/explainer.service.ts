import { Injectable, Logger } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { PrismaService } from '../../../../prisma';
import { LlmSafetyPolicyService } from '../../../../common/llm/safety/llm-safety-policy.service';
import { extractErrorInfo } from '../../../../common';
import { resolveLocale } from '../../../../common';
import { createDomainFailure, fromPromise } from '../../../../common/result';
import type { DomainFailure, ResultAsync } from '../../../../common/result';
import { DomainFailureException } from '../../../../common/result/domain-failure.exception';
import type {
  ExplanationContext,
  ExplanationPromptCopy,
} from '../../prompts/explanation.prompt';
import { ExplanationGeneratorService } from './generator.service';

/**
 * Result of an AI explanation request.
 */
export interface ExplanationResult {
  suggestionId: string;
  reason: string;
  boundary: string;
  /** Whether the AI model was used (false = fallback to persisted copy text). */
  aiGenerated: boolean;
}

/**
 * AI explanation layer for suggestion cards.
 *
 * Design principles (aligned with Product_AI_Design):
 * - Rule-first, AI only explains — the suggestion already exists with rule text.
 * - AI generates enhanced reason/boundary variants on demand, not blocking first screen.
 * - All LLM output must be grounded in the suggestion's evidence[].
 * - All LLM output passes through LlmSafetyPolicyService.
 * - If the model is not configured or fails, falls back to persisted copy text.
 */
@Injectable()
export class ExplanationService {
  private readonly logger = new Logger(ExplanationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly generatorService: ExplanationGeneratorService,
    private readonly policyService: LlmSafetyPolicyService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Generates an AI-enhanced explanation for a suggestion card.
   *
   * @param userId - The requesting user's ID.
   * @param suggestionId - The suggestion to explain.
   * @param language - Accept-Language header value (optional).
   * @returns Enhanced reason and boundary text, or the original if AI is unavailable.
   *
   * A missing suggestion is an expected client failure and becomes a
   * `ResultAsync` Err (SUGGESTION_NOT_FOUND); unknown failures re-throw.
   */
  explain(
    userId: string,
    suggestionId: string,
    language?: string,
  ): ResultAsync<ExplanationResult, DomainFailure> {
    return fromPromise(
      this.doExplain(userId, suggestionId, language),
      (error) => {
        if (error instanceof DomainFailureException) {
          return error.failure;
        }
        throw error;
      },
    );
  }

  private async doExplain(
    userId: string,
    suggestionId: string,
    language?: string,
  ): Promise<ExplanationResult> {
    const locale = resolveLocale(language);

    const suggestion = await this.prisma.userSuggestion.findFirst({
      where: { id: suggestionId, userId },
    });

    if (suggestion == null) {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'not_found',
          code: 'SUGGESTION_NOT_FOUND',
          detail: this.i18n.t('today-suggestion.error.not_found', {
            lang: locale,
          }),
        }),
      );
    }

    const context = this.buildContext(suggestion);
    const promptCopy = this.buildPromptCopy(locale);

    const output = await this.generateWithFallback(
      context,
      promptCopy,
      suggestionId,
    );

    return {
      suggestionId,
      reason: output.reason,
      boundary: output.boundary,
      aiGenerated: output.aiGenerated,
    };
  }

  private async generateWithFallback(
    context: ExplanationContext,
    promptCopy: ExplanationPromptCopy,
    suggestionId: string,
  ): Promise<{ reason: string; boundary: string; aiGenerated: boolean }> {
    // If no model configured, return original rule text immediately.
    if (!this.generatorService.hasAnalysisModel()) {
      this.logger.debug(
        `Model not configured for suggestion ${suggestionId}; returning original text`,
      );
      return {
        reason: context.originalReason,
        boundary: context.originalBoundary,
        aiGenerated: false,
      };
    }

    try {
      const raw = await this.generatorService.generate(context, promptCopy);

      // Safety check: reject output containing forbidden patterns.
      if (this.policyService.isSafe([raw.reason, raw.boundary])) {
        return {
          reason: raw.reason,
          boundary: raw.boundary,
          aiGenerated: true,
        };
      }

      this.logger.warn(
        `Policy rejected AI explanation for suggestion ${suggestionId}; falling back`,
      );
    } catch (error) {
      const { message: reason } = extractErrorInfo(error);
      this.logger.warn(
        `AI explanation failed for suggestion ${suggestionId}; falling back: ${reason}`,
      );
    }

    return {
      reason: context.originalReason,
      boundary: context.originalBoundary,
      aiGenerated: false,
    };
  }

  private buildContext(suggestion: {
    type: string;
    triggerType: string;
    confidence: string;
    title: string;
    ruleId: string;
    subtype: string | null;
    evidence: unknown;
    reason: string;
    boundary: string;
  }): ExplanationContext {
    return {
      suggestionType: suggestion.type as ExplanationContext['suggestionType'],
      triggerType: suggestion.triggerType as ExplanationContext['triggerType'],
      confidence: suggestion.confidence as ExplanationContext['confidence'],
      title: suggestion.title,
      ruleId: suggestion.ruleId,
      ...(suggestion.subtype != null ? { subtype: suggestion.subtype } : {}),
      evidence: suggestion.evidence as ExplanationContext['evidence'],
      originalReason: suggestion.reason,
      originalBoundary: suggestion.boundary,
    };
  }

  private buildPromptCopy(locale: string): ExplanationPromptCopy {
    return {
      userIntro: this.i18n.t('today-suggestion.prompt.explanation_user_intro', {
        lang: locale,
      }),
      tone: this.i18n.t('today-suggestion.prompt.explanation_tone', {
        lang: locale,
      }),
      constraints: this.i18n.t(
        'today-suggestion.prompt.explanation_constraints',
        { lang: locale },
      ),
      factsLabel: this.i18n.t('today-suggestion.prompt.facts_label', {
        lang: locale,
      }),
    };
  }
}
