export {
  err,
  errAsync,
  fromPromise,
  ok,
  okAsync,
  Result,
  ResultAsync,
} from 'neverthrow';

export { createDomainFailure, isDomainFailure } from './domain-failure';
export { DomainFailureException } from './domain-failure.exception';
export type {
  CreateDomainFailureInput,
  DomainFailure,
  DomainFailureCode,
  DomainFailureKind,
} from './domain-failure';
export { toProblemDetails } from './domain-failure.mapper';
export type { DomainFailureProblemOptions } from './domain-failure.mapper';
export {
  mapUnknownToDependencyFailure,
  mapUnknownToInternalFailure,
} from './unknown-error.mapper';
export { unwrapResult } from './unwrap-result';
