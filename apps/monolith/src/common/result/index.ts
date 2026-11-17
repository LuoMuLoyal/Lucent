export {
  err,
  errAsync,
  fromPromise,
  ok,
  okAsync,
  Result,
  ResultAsync,
} from 'neverthrow';

export { createDomainFailure, isDomainFailure } from './domain-failure.js';
export { DomainFailureException } from './domain-failure.exception.js';
export type {
  CreateDomainFailureInput,
  DomainFailure,
  DomainFailureCode,
  DomainFailureKind,
} from './domain-failure.js';
export { toProblemDetails } from './domain-failure.mapper.js';
export type { DomainFailureProblemOptions } from './domain-failure.mapper.js';
export {
  mapUnknownToDependencyFailure,
  mapUnknownToInternalFailure,
} from './unknown-error.mapper.js';
export { unwrapResult } from './unwrap-result.js';
