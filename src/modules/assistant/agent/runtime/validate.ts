import type { AssistantToolExecutionResult } from '../../types/assistant.types';
import type { AssistantValidationFlags } from './state';
import { DEFAULT_VALIDATION_FLAGS } from './state';

/**
 * Validates read-tool results against the server-owned envelope.
 *
 * Inspects each result's `data.coverage.status` ('complete' | 'partial' |
 * 'empty') and `data.ambiguities`, producing a compact {@link AssistantValidationFlags}
 * object. Non-read results are skipped.
 */
export function validateReadResults(
  toolResults: readonly AssistantToolExecutionResult[],
): AssistantValidationFlags {
  const flags: AssistantValidationFlags = { ...DEFAULT_VALIDATION_FLAGS };

  for (const result of toolResults) {
    const data = result.data;

    const coverage = data['coverage'];
    if (coverage != null && typeof coverage === 'object') {
      const status = (coverage as { status?: unknown }).status;
      if (status === 'empty') {
        flags.hasEmptyResults = true;
      } else if (status === 'partial') {
        flags.hasPartialCoverage = true;
      }
    }

    const ambiguities = data['ambiguities'];
    if (Array.isArray(ambiguities) && ambiguities.length > 0) {
      flags.hasAmbiguities = true;
    }
  }

  return flags;
}
