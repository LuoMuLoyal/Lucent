/**
 * Ports for the Today Analysis generation pipeline (ADR-0024 D2).
 *
 * The use case orchestrates context assembly, LLM generation and
 * materialization. All three are implemented outside `application/`, so it
 * names them as contracts and the module binds the tokens with `useExisting`.
 *
 * Same pattern as `ports/materialization.ts` and the `reports` module: name the
 * contract, let the composition root choose the implementation.
 */

import type { TodayAnalysisContext } from '../read_models/analysis-context-shape.js';
import type { TodayAnalysisStructuredOutput } from './analysis-output.js';
import type { BaseLlmGeneratorService } from '../../../../common/llm/generators/base-llm-generator.service.js';
import type { PromptCopy } from '../../../../common/index.js';

/** Injection token for {@link AnalysisContextSource}. */
export const ANALYSIS_CONTEXT_SOURCE = Symbol('AnalysisContextSource');

/** Injection token for {@link AnalysisGenerator}. */
export const ANALYSIS_GENERATOR = Symbol('AnalysisGenerator');

/**
 * Assembles the analysis input from every upstream context.
 *
 * Implemented by `adapters/acl/analysis-context.ts`, which reads each source
 * through its own reader port.
 */
export interface AnalysisContextSource {
  build(
    userId: string,
    date: string,
    options?: { locale?: string; eventId?: string | null },
  ): Promise<TodayAnalysisContext>;

  invalidateContext(userId: string, date: string): Promise<void>;
}

/** What the use case needs from the LLM generator. */
export type AnalysisGenerator = BaseLlmGeneratorService<
  TodayAnalysisContext,
  PromptCopy,
  TodayAnalysisStructuredOutput
>;
