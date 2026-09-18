import { classifyProviderFailure } from './provider-failure.js';

describe('classifyProviderFailure', () => {
  it('treats a rate limit as a retryable dependency outage', () => {
    const result = classifyProviderFailure({ status: 429 });
    expect(result).toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      retryable: true,
    });
  });

  it.each([500, 502, 503])(
    'maps HTTP %i to a retryable bad gateway',
    (status) => {
      expect(classifyProviderFailure({ status })).toMatchObject({
        code: 'DEPENDENCY_BAD_GATEWAY',
        retryable: true,
      });
    },
  );

  it('maps a timeout to DEPENDENCY_TIMEOUT', () => {
    expect(classifyProviderFailure({ status: 504 })).toMatchObject({
      code: 'DEPENDENCY_TIMEOUT',
      retryable: true,
    });
  });

  it.each([400, 404, 422])(
    'marks HTTP %i as a non-retryable model rejection',
    (status) => {
      // A retired model id will fail identically on every replay, so the
      // client must not be told to simply try again.
      expect(classifyProviderFailure({ status })).toMatchObject({
        code: 'DEPENDENCY_UNAVAILABLE',
        retryable: false,
      });
    },
  );

  it.each([401, 403])(
    'reports HTTP %i as a credentials/quota problem and stays retryable',
    (status) => {
      expect(classifyProviderFailure({ status })).toMatchObject({
        code: 'DEPENDENCY_UNAVAILABLE',
        retryable: true,
      });
    },
  );

  it('reads the status off the nested response shape clients throw', () => {
    expect(
      classifyProviderFailure({ response: { status: 429 } }),
    ).toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      retryable: true,
    });
    expect(classifyProviderFailure({ statusCode: 503 })).toMatchObject({
      code: 'DEPENDENCY_BAD_GATEWAY',
    });
  });

  it.each([null, undefined, 'boom', 42, {}, new Error('programmer error')])(
    'returns null for a non-provider error (%s)',
    (error) => {
      // Unrelated exceptions must keep propagating to the generic handler
      // rather than being relabelled as a model outage.
      expect(classifyProviderFailure(error)).toBeNull();
    },
  );
});
