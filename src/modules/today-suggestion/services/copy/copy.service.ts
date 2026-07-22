/**
 * Main service for generating suggestion card copy.
 *
 * This service orchestrates:
 * 1. Cache lookup (avoid redundant LLM calls)
 * 2. LLM generation (via CopyGeneratorService)
 * 3. Fallback to pre-written copy (if LLM fails)
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { CopyGeneratorService } from './generator.service';
import { SuggestionCacheService } from '../cache/suggestion-cache.service';
import { getFallbackCopy, validateCopyTemplate } from '../../constants';

export interface CopyGenerationResult {
  title: string;
  reason: string;
  boundary: string;
  actionLabel: string;
  aiGenerated: boolean;
  fromCache: boolean;
}

export interface CopyGenerationRequest {
  templateKey: string;
  params: Record<string, string | number>;
  locale: string;
  tone?: 'gentle' | 'direct' | 'professional';
}

@Injectable()
export class SuggestionCopyService {
  private readonly logger = new Logger(SuggestionCopyService.name);

  constructor(
    private readonly generator: CopyGeneratorService,
    private readonly cache: SuggestionCacheService,
  ) {}

  /**
   * Generates copy for a suggestion card.
   *
   * Flow:
   * 1. Validate template and params
   * 2. Check cache
   * 3. Try LLM generation
   * 4. Fall back to pre-written copy if needed
   */
  async generate(
    request: CopyGenerationRequest,
  ): Promise<CopyGenerationResult> {
    const { templateKey, params, locale, tone = 'gentle' } = request;

    // Validate template
    const validation = validateCopyTemplate(templateKey, params);
    if (!validation.valid) {
      this.logger.warn(
        `Invalid copy template params for ${templateKey}: ${validation.missing?.join(', ') ?? 'unknown'}`,
      );
      // Still try fallback
      return this.getFallbackResult(templateKey, locale);
    }

    // Build cache key
    const cacheKey = this.buildCacheKey(templateKey, params, locale);

    // Check cache
    const cached = await this.cache.getCopy(cacheKey);
    if (cached) {
      return {
        ...cached,
        aiGenerated: true,
        fromCache: true,
      };
    }

    // Try LLM generation
    if (this.generator.isAvailable()) {
      try {
        const generated = await this.generator.generate(templateKey, params, {
          locale,
          tone,
        });

        if (generated) {
          // Cache the result
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
      } catch (error) {
        this.logger.error(
          `LLM copy generation failed for ${templateKey}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Fall back to pre-written copy
    return this.getFallbackResult(templateKey, locale);
  }

  /**
   * Generates copy for multiple candidates in parallel.
   */
  async generateBatch(
    requests: CopyGenerationRequest[],
  ): Promise<Map<string, CopyGenerationResult>> {
    const results = new Map<string, CopyGenerationResult>();

    await Promise.all(
      requests.map(async (request) => {
        const result = await this.generate(request);
        results.set(request.templateKey, result);
      }),
    );

    return results;
  }

  /**
   * Gets fallback copy and converts to result format.
   */
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

    // Ultimate fallback if no template exists
    this.logger.error(`No fallback copy found for template: ${templateKey}`);
    return {
      title: '建议',
      reason: '系统检测到相关健康信号。',
      boundary: '此建议仅供参考，不能替代专业医疗意见。',
      actionLabel: '查看',
      aiGenerated: false,
      fromCache: false,
    };
  }

  /**
   * Builds a deterministic cache key for copy generation.
   */
  private buildCacheKey(
    templateKey: string,
    params: Record<string, string | number>,
    locale: string,
  ): string {
    // Normalize params for consistent hashing
    const sortedParams = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${String(v)}`)
      .join('|');

    const keyString = `${templateKey}:${locale}:${sortedParams}`;
    return createHash('sha256').update(keyString).digest('hex').slice(0, 32);
  }
}
