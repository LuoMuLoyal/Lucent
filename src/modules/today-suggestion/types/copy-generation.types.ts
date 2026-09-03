import type {
  SuggestionType,
  SuggestionConfidence,
} from './suggestion.types.js';
import type { EvidenceItem } from './signal.types.js';

/**
 * BullMQ job data — carries complete context for LLM copy generation.
 *
 * Includes evidence, confidence, suggestionType, ruleId, subtype so the LLM
 * can produce more grounded copy.
 *
 * Note: the cache key is still computed from templateKey + params + locale only,
 * because evidence is deterministically derived from the same rule + params and
 * therefore does not affect deduplication.
 */
export interface CopyJobData {
  templateKey: string;
  params: Record<string, string | number>;
  locale: string;
  tone?: 'gentle' | 'direct' | 'professional';

  /** Suggestion type — influences tone and wording strategy. */
  suggestionType: SuggestionType;
  /** Confidence level — high confidence allows more direct language. */
  confidence: SuggestionConfidence;
  /** Rule ID — gives the LLM context about the suggestion source. */
  ruleId: string;
  /** Subtype (e.g. 'water', 'sleep', 'caffeine') — helps LLM understand the scenario. */
  subtype?: string;
  /** Evidence items — the LLM's reason should reference specific data from here. */
  evidence: EvidenceItem[];
}

/** LLM generator context (isomorphic with CopyJobData). */
export type CopyGenerationContext = CopyJobData;

/** Localized prompt copy passed to the LLM generator. */
export interface CopyPromptCopy {
  tone: 'gentle' | 'direct' | 'professional';
  userIntro: string;
  constraints: string;
  factsLabel: string;
}
