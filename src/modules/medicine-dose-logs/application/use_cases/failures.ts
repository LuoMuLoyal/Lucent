/**
 * Failure helpers for the dose-log use cases.
 *
 * ## Why the use cases throw `DomainFailureException` instead of returning an Err
 *
 * The write paths are async/await (five sequential awaits that must not run when
 * an earlier step fails). Forcing each step through a Result chain produced
 * `andThen` ladders that were harder to read than the code they replaced. So the
 * use cases throw the ADR-0012 exception form and let `execute` fold it back into
 * the `Result` channel once:
 *
 * - `DomainFailureException` -> the carried `DomainFailure` (a business outcome);
 * - anything else -> rethrown untouched (infrastructure, never a 4xx).
 *
 * `fromFailure` is the single place that decision is made.
 */

import { createDomainFailure } from '../../../../common/result/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import { DomainFailureException } from '../../../../common/result/index.js';
import { fromPromise } from '../../../../common/result/index.js';

/** `DOSE_LOG_TARGET_UNRESOLVED`: the payload parsed but names no usable slot. */
export function unresolvedTarget(): never {
  throw new DomainFailureException(
    createDomainFailure({
      kind: 'validation',
      code: 'DOSE_LOG_TARGET_UNRESOLVED',
    }),
  );
}

/** `RESOURCE_NOT_FOUND` for a missing reminder / medicine / dose log. */
export function notFound(): never {
  throw new DomainFailureException(
    createDomainFailure({ kind: 'not_found', code: 'RESOURCE_NOT_FOUND' }),
  );
}

/**
 * Folds a throwing async write path into the Result channel.
 *
 * A `DomainFailureException` becomes the carried failure; every other rejection
 * propagates unchanged so it reaches the global filter as infrastructure.
 */
export function fromFailure<T>(run: Promise<T>): ResultAsync<T, DomainFailure> {
  return fromPromise(run, (error) => {
    if (error instanceof DomainFailureException) {
      return error.failure;
    }
    throw error;
  });
}
