import { describe, expect, it } from 'vitest';
import { DomainFailureException } from '../../../common/result/index.js';
import { createDomainFailure } from '../../../common/result/index.js';
import { toDomainFailure } from './domain-failure.js';

describe('assistant toDomainFailure', () => {
  it('keeps the domain failure when the error is already normalized', () => {
    const failure = createDomainFailure({
      kind: 'not_found',
      code: 'RESOURCE_NOT_FOUND',
    });

    expect(toDomainFailure(new DomainFailureException(failure))).toBe(failure);
  });

  it('classifies a provider outage by code and retry hint', () => {
    const failure = toDomainFailure({ status: 429 });

    expect(failure.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(failure.kind).toBe('dependency');
    expect(failure.retryable).toBe(true);
  });

  it('does not attach provider prose as outbound detail', () => {
    // A hardcoded English sentence here would override the bilingual
    // `problem_dependency_unavailable_detail` registry copy for every locale.
    const failure = toDomainFailure({ status: 429 });

    expect(failure.detail).toBeUndefined();
  });

  it('marks a retired model id as non-retryable', () => {
    const failure = toDomainFailure({ status: 404 });

    expect(failure.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(failure.retryable).toBe(false);
  });

  it('rethrows an unrecognized error instead of mislabelling it', () => {
    const bug = new Error('programmer error');

    expect(() => toDomainFailure(bug)).toThrow(bug);
  });
});
