import type { ResultAsync } from '.';
import type { DomainFailure } from './domain-failure';
import { DomainFailureException } from './domain-failure.exception';

export { DomainFailureException } from './domain-failure.exception';

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
