import { createDomainFailure, isDomainFailure } from './domain-failure.js';

describe('DomainFailure', () => {
  it('creates a typed recoverable failure without HTTP fields', () => {
    const failure = createDomainFailure({
      kind: 'validation',
      code: 'VALIDATION_FAILED',
      detail: 'The date is invalid.',
      errors: { date: ['Use YYYY-MM-DD.'] },
      retryable: false,
    });

    expect(failure).toMatchObject({
      _tag: 'DomainFailure',
      kind: 'validation',
      code: 'VALIDATION_FAILED',
      detail: 'The date is invalid.',
      errors: { date: ['Use YYYY-MM-DD.'] },
      retryable: false,
    });
    expect('status' in failure).toBe(false);
    expect('statusCode' in failure).toBe(false);
    expect(isDomainFailure(failure)).toBe(true);
  });

  it('preserves diagnostic cause without making it a wire field', () => {
    const cause = new Error('database timeout');
    const failure = createDomainFailure({
      kind: 'dependency',
      code: 'DEPENDENCY_TIMEOUT',
      cause,
      retryAfter: 3,
    });

    expect(failure.cause).toBe(cause);
    expect(failure.retryAfter).toBe(3);
    expect('cause' in failure).toBe(true);
  });

  it('carries safe i18n args without leaking objects or booleans', () => {
    const failure = createDomainFailure({
      kind: 'rate_limited',
      code: 'AUTH_VERIFICATION_CODE_COOLDOWN',
      args: { minutes: 5 },
      retryAfter: 300,
    });

    expect(failure.args).toEqual({ minutes: 5 });
    expect(isDomainFailure(failure)).toBe(true);
  });

  it('rejects args containing non-primitive values', () => {
    expect(() =>
      createDomainFailure({
        kind: 'rate_limited',
        code: 'AUTH_VERIFICATION_CODE_COOLDOWN',
        args: { minutes: { value: 5 } as never },
      }),
    ).toThrow();

    expect(() =>
      createDomainFailure({
        kind: 'rate_limited',
        code: 'AUTH_VERIFICATION_CODE_COOLDOWN',
        args: { active: true as never },
      }),
    ).toThrow();
  });

  it('rejects a kind/code pair that is not documented together', () => {
    expect(() =>
      createDomainFailure({
        kind: 'validation',
        code: 'RESOURCE_NOT_FOUND',
      }),
    ).toThrow();

    expect(() =>
      createDomainFailure({
        kind: 'not_found',
        code: 'VALIDATION_FAILED',
      }),
    ).toThrow();
  });

  it.each([
    ['', 'empty code'],
    ['SERVER_SHUTDOWN', 'transport-only code'],
    ['STREAM_CANCELLED', 'transport-only code'],
  ])('rejects %s (%s)', (code) => {
    expect(() =>
      createDomainFailure({
        kind: 'internal',
        code: code as never,
      }),
    ).toThrow();
  });

  it('rejects invalid retryAfter and errors values', () => {
    expect(() =>
      createDomainFailure({
        kind: 'rate_limited',
        code: 'RATE_LIMITED',
        retryAfter: -1,
      }),
    ).toThrow();

    expect(() =>
      createDomainFailure({
        kind: 'validation',
        code: 'VALIDATION_FAILED',
        errors: [] as never,
      }),
    ).toThrow();
  });

  it('rejects arbitrary values in the type guard', () => {
    expect(isDomainFailure(null)).toBe(false);
    expect(isDomainFailure({ _tag: 'DomainFailure' })).toBe(false);
    expect(
      isDomainFailure({ kind: 'validation', code: 'VALIDATION_FAILED' }),
    ).toBe(false);
    expect(
      isDomainFailure({
        _tag: 'DomainFailure',
        kind: 'validation',
        code: 'VALIDATION_FAILED',
        args: { x: null },
      }),
    ).toBe(false);
  });
});
