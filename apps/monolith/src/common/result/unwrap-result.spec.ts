import { errAsync, okAsync } from './index.js';
import { createDomainFailure } from './domain-failure.js';
import { DomainFailureException, unwrapResult } from './unwrap-result.js';

describe('unwrapResult', () => {
  it('returns the Ok value', async () => {
    await expect(unwrapResult(okAsync({ id: 'account-1' }))).resolves.toEqual({
      id: 'account-1',
    });
  });

  it('throws a non-wire DomainFailureException for Err', async () => {
    const failure = createDomainFailure({
      kind: 'not_found',
      code: 'RESOURCE_NOT_FOUND',
    });

    await expect(unwrapResult(errAsync(failure))).rejects.toBeInstanceOf(
      DomainFailureException,
    );
    await expect(unwrapResult(errAsync(failure))).rejects.toMatchObject({
      failure,
    });
  });
});
