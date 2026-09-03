import type { ResultAsync } from './index.js';
import type { DomainFailure } from './domain-failure.js';
import { DomainFailureException } from './domain-failure.exception.js';

export { DomainFailureException } from './domain-failure.exception.js';

export async function unwrapResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<T> {
  return result.match(
    (value) => value,
    (failure) => {
      throw new DomainFailureException(failure);
    },
  );
}
