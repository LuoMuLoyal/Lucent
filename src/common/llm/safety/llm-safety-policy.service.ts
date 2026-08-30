import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { llmConfig } from '../../../config/services/llm.config';

const DEFAULT_FORBIDDEN_PATTERNS = [
  /诊断/u,
  /确诊/u,
  /停药/u,
  /减药/u,
  /加药/u,
  /增量/u,
  /减量/u,
  /剂量/u,
  /药量/u,
  /处方/u,
  /治愈/u,
  /治疗方案/u,
  /\bdiagnos(?:e|is|ed|ing)\b/iu,
  /\bprescription\b/iu,
  /\bcure\b/iu,
  /\btreatment plan\b/iu,
  /\bstop(?:ping)? medication\b/iu,
  /\bchange (?:the )?dose\b/iu,
  /\badjust(?:ing)? (?:the )?dose\b/iu,
  /\bincrease(?:ing)? (?:the )?dose\b/iu,
  /\bdecrease(?:ing)? (?:the )?dose\b/iu,
  /\bdosage\b/iu,
];

/**
 * Shared LLM content safety policy.
 *
 * Centralizes forbidden-pattern checks so that every LLM module applies the
 * same safety rules instead of copy-pasting them. Patterns can be overridden
 * at runtime via the `AI_SAFETY_FORBIDDEN_PATTERNS` environment variable
 * (comma or newline separated regex strings).
 */
@Injectable()
export class LlmSafetyPolicyService {
  private readonly forbiddenPatterns: RegExp[];

  constructor(
    @Inject(llmConfig.KEY)
    config: ConfigType<typeof llmConfig>,
  ) {
    const configured = config.safety.forbiddenPatterns;
    this.forbiddenPatterns =
      configured.length > 0
        ? configured.map((pattern) => new RegExp(pattern, 'iu'))
        : DEFAULT_FORBIDDEN_PATTERNS;
  }

  isSafe(texts: string[]): boolean {
    return texts.every((text) => this.isSafeText(text));
  }

  isSafeSummaryText(text: string): boolean {
    return text.trim().length > 0 && this.isSafeText(text);
  }

  isSafeText(text: string): boolean {
    return !this.forbiddenPatterns.some((pattern) => pattern.test(text));
  }
}
