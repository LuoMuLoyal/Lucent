import {
  createDomainFailure,
  DomainFailureException,
  type DomainFailure,
} from '../../../common/result/index.js';
import { classifyProviderFailure } from './provider-failure.js';

/**
 * Normalizes whatever a collapsed `ResultAsync` produced into a domain failure.
 *
 * Three call sites used to carry their own copy of this (`stream-orchestrator`,
 * `agent/runtime`, `proposal-confirm`). The copies were identical, so every
 * extension of {@link classifyProviderFailure} — e.g. the 401/403 retryable
 * branch — had to be reflected in all of them by hand, and a missed copy would
 * silently downgrade a diagnosable provider outage back into a blanket 500.
 *
 * A `DomainFailureException` is already the normalized form and passes through
 * unchanged. Anything else is offered to the provider classifier; when that
 * returns null the original error is rethrown rather than folded into a
 * generic failure — an unrecognized exception is a bug here, and hiding it
 * behind "dependency failed" is how real defects get attributed to the LLM.
 */
export function toDomainFailure(error: unknown): DomainFailure {
  if (error instanceof DomainFailureException) {
    return error.failure;
  }

  const provider = classifyProviderFailure(error);
  if (provider != null) {
    return createDomainFailure({
      kind: 'dependency',
      code: provider.code,
      // The classifier exists to pick a code and a retry hint. Its prose was
      // also passed as `detail`, which overrides the registered bilingual
      // detail in `ProblemCatalog.build` (`options.detail ?? translate(...)`),
      // so English users got a hardcoded English sentence and zh users got
      // English too. The registry owns outbound copy (ADR-0012); the sentence
      // is kept in `cause` for logs only.
      retryable: provider.retryable,
      cause: error,
    });
  }

  throw error;
}
