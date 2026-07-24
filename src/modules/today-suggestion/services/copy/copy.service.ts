/**
 * Main service for generating suggestion card copy.
 *
 * Read path (user request):
 *   getOrEnqueue() — check Redis cache; hit → return AI copy; miss → return fallback + enqueue.
 *
 * Write path (BullMQ worker):
 *   generateViaLlm() — second cache check, call LLM, store result in cache.
 *
 * Fallback path (Redis unavailable):
 *   generateSync() — inline LLM call with cache check.
 */
import { Injectable, Logger } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { createHash } from 'crypto';
import { SuggestionCopyLlmService } from './copy-llm-generator.service';
import { SuggestionCacheService } from '../cache/suggestion-cache.service';
import { getFallbackCopy } from '../../constants/copy-fallback';

import { validateCopyTemplate } from '../../constants/copy-templates';
import type {
  CopyJobData,
  CopyPromptCopy,
} from '../../types/copy-generation.types';

export interface CopyGenerationResult {
  title: string;
  reason: string;
  boundary: string;
  actionLabel: string;
  aiGenerated: boolean;
  fromCache: boolean;
}

/**
 * Minimal interface for the queue dependency used by the read path.
 * This avoids a circular import between `copy.service.ts` and `copy-queue.service.ts`.
 */
export interface CopyQueueLike {
  readonly isConfigured: boolean;
  enqueue(data: CopyJobData): Promise<string | null>;
}

@Injectable()
export class SuggestionCopyService {
  private readonly logger = new Logger(SuggestionCopyService.name);

  constructor(
    private readonly llmService: SuggestionCopyLlmService,
    private readonly cache: SuggestionCacheService,
    private readonly i18n: I18nService,
  ) {}

  // ─── Read path: called on user request ───

  /**
   * Read path entry point. Checks Redis cache first; on hit returns AI copy.
   * On miss, returns fallback copy and enqueues an async generation job.
   *
   * Does not block the user request and does not call LLM directly
   * (when Redis/BullMQ is available).
   */
  async getOrEnqueue(
    request: CopyJobData,
    queue?: CopyQueueLike,
  ): Promise<CopyGenerationResult> {
    const { templateKey, params, locale } = request;

    // 1. Validate template
    const validation = validateCopyTemplate(templateKey, params);
    if (!validation.valid) {
      this.logger.warn(
        `Invalid copy template params for ${templateKey}: ${validation.missing?.join(', ') ?? 'unknown'}`,
      );
      return this.getFallbackResult(templateKey, locale);
    }

    // 2. Check Redis cache
    const cacheKey = this.buildCacheKey(templateKey, params, locale);
    const cached = await this.cache.getCopy(cacheKey);
    if (cached) {
      return {
        title: cached.title,
        reason: cached.reason,
        boundary: cached.boundary,
        actionLabel: cached.actionLabel,
        aiGenerated: true,
        fromCache: true,
      };
    }

    // 3. Cache miss — enqueue async generation (with full context)
    if (queue?.isConfigured) {
      await queue.enqueue(request);
    }

    // 4. Return fallback copy
    return this.getFallbackResult(templateKey, locale);
  }

  /**
   * Batch read path. Calls getOrEnqueue for each request in parallel.
   */
  async getOrEnqueueBatch(
    requests: CopyJobData[],
    queue?: CopyQueueLike,
  ): Promise<Map<string, CopyGenerationResult>> {
    const results = new Map<string, CopyGenerationResult>();
    await Promise.all(
      requests.map(async (request) => {
        const result = await this.getOrEnqueue(request, queue);
        results.set(request.templateKey, result);
      }),
    );
    return results;
  }

  // ─── Write path: called by BullMQ worker ───

  /**
   * Worker entry point. Called by the BullMQ worker to perform actual LLM generation.
   *
   * Includes a second cache check (deduplication: multiple identical jobs
   * only trigger one LLM call).
   */
  async generateViaLlm(data: CopyJobData): Promise<CopyGenerationResult> {
    const cacheKey = this.buildCacheKey(
      data.templateKey,
      data.params,
      data.locale,
    );

    // Second cache check — concurrent deduplication
    const cached = await this.cache.getCopy(cacheKey);
    if (cached) {
      return {
        title: cached.title,
        reason: cached.reason,
        boundary: cached.boundary,
        actionLabel: cached.actionLabel,
        aiGenerated: true,
        fromCache: true,
      };
    }

    // Check if LLM is available
    if (!this.llmService.hasAnalysisModel()) {
      this.logger.warn('LLM not configured, skipping copy generation');
      return this.getFallbackResult(data.templateKey, data.locale);
    }

    // Call LLM to generate (passing full context)
    const generated = await this.llmService.generate(
      data, // CopyJobData is CopyGenerationContext, contains full info
      this.buildPromptCopy(data.tone ?? 'gentle', data.locale),
    );

    // Store in cache
    await this.cache.setCopy(cacheKey, generated);

    return {
      title: generated.title,
      reason: generated.reason,
      boundary: generated.boundary,
      actionLabel: generated.actionLabel,
      aiGenerated: true,
      fromCache: false,
    };
  }

  // ─── Fallback path: synchronous LLM call when Redis is unavailable ───

  /**
   * Synchronous LLM call (fallback when Redis/BullMQ is unavailable).
   * Called by SuggestionService when queue.isConfigured === false.
   */
  async generateSync(request: CopyJobData): Promise<CopyGenerationResult> {
    const { templateKey, params, locale, tone = 'gentle' } = request;

    const validation = validateCopyTemplate(templateKey, params);
    if (!validation.valid) {
      return this.getFallbackResult(templateKey, locale);
    }

    // Still check cache first (Redis might be up but BullMQ might not)
    const cacheKey = this.buildCacheKey(templateKey, params, locale);
    const cached = await this.cache.getCopy(cacheKey);
    if (cached) {
      return {
        title: cached.title,
        reason: cached.reason,
        boundary: cached.boundary,
        actionLabel: cached.actionLabel,
        aiGenerated: true,
        fromCache: true,
      };
    }

    if (!this.llmService.hasAnalysisModel()) {
      return this.getFallbackResult(templateKey, locale);
    }

    try {
      const generated = await this.llmService.generate(
        request,
        this.buildPromptCopy(tone, locale),
      );
      await this.cache.setCopy(cacheKey, generated);
      return {
        title: generated.title,
        reason: generated.reason,
        boundary: generated.boundary,
        actionLabel: generated.actionLabel,
        aiGenerated: true,
        fromCache: false,
      };
    } catch (error) {
      this.logger.error(
        `Sync copy generation failed for ${templateKey}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.getFallbackResult(templateKey, locale);
    }
  }

  /**
   * Batch synchronous call (fallback when Redis is unavailable).
   */
  async generateSyncBatch(
    requests: CopyJobData[],
  ): Promise<Map<string, CopyGenerationResult>> {
    const results = new Map<string, CopyGenerationResult>();
    await Promise.all(
      requests.map(async (request) => {
        const result = await this.generateSync(request);
        results.set(request.templateKey, result);
      }),
    );
    return results;
  }

  // ─── Private helpers ───

  private buildPromptCopy(
    tone: 'gentle' | 'direct' | 'professional',
    locale: string,
  ): CopyPromptCopy {
    return {
      tone,
      userIntro: this.i18n.t('today-suggestion.prompt.copy_user_intro', {
        lang: locale,
      }),
      constraints: this.i18n.t('today-suggestion.prompt.copy_constraints', {
        lang: locale,
      }),
      factsLabel: this.i18n.t('today-suggestion.prompt.facts_label', {
        lang: locale,
      }),
    };
  }

  private getFallbackResult(
    templateKey: string,
    locale: string,
  ): CopyGenerationResult {
    const fallback = getFallbackCopy(templateKey, locale);
    if (fallback) {
      return {
        title: fallback.title,
        reason: fallback.reason,
        boundary: fallback.boundary,
        actionLabel: fallback.actionLabel,
        aiGenerated: false,
        fromCache: false,
      };
    }
    this.logger.error(`No fallback copy found for template: ${templateKey}`);
    return {
      title: this.i18n.t('today-suggestion.fallback.title', { lang: locale }),
      reason: this.i18n.t('today-suggestion.fallback.reason', { lang: locale }),
      boundary: this.i18n.t('today-suggestion.fallback.boundary', {
        lang: locale,
      }),
      actionLabel: this.i18n.t('today-suggestion.fallback.action_label', {
        lang: locale,
      }),
      aiGenerated: false,
      fromCache: false,
    };
  }

  /**
   * Builds a deterministic cache key from template key, params, and locale.
   *
   * IMPORTANT: This cache is intentionally shared across users — the same
   * template + params + locale always produces the same copy. This is safe
   * because copy text is derived from rule logic (evidence values, suggestion
   * types, etc.), not from user-specific data. Never include userId or other
   * user-sensitive information in `params`, or one user's copy may be served
   * to another.
   */
  private buildCacheKey(
    templateKey: string,
    params: Record<string, string | number>,
    locale: string,
  ): string {
    const sortedParams = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${String(v)}`)
      .join('|');
    const keyString = `${templateKey}:${locale}:${sortedParams}`;
    return createHash('sha256').update(keyString).digest('hex').slice(0, 32);
  }
}
