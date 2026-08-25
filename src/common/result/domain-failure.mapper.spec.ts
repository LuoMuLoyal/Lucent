import { ProblemCatalog } from '../api/problem-catalog';
import { createDomainFailure } from './domain-failure';
import { toProblemDetails } from './domain-failure.mapper';
import { DomainFailureException } from './domain-failure.exception';

describe('toProblemDetails', () => {
  const catalog = new ProblemCatalog({
    t: (key: string, options?: { args?: Record<string, string | number> }) =>
      options?.args
        ? `translated:${key}:${JSON.stringify(options.args)}`
        : `translated:${key}`,
  } as never);

  it('delegates status, URI, and localization to ProblemCatalog', () => {
    const failure = createDomainFailure({
      kind: 'conflict',
      code: 'RECORD_ALREADY_EXISTS',
      detail: 'A record already exists for this date.',
      retryable: false,
      cause: new Error('private cause'),
    });

    expect(
      toProblemDetails(failure, {
        catalog,
        lang: 'en',
        traceId: 'trace-123',
      }),
    ).toEqual({
      type: 'https://api.lumos.example/problems/record-already-exists',
      title: 'translated:common.problem_record_already_exists_title',
      detail: 'A record already exists for this date.',
      code: 'RECORD_ALREADY_EXISTS',
      retryable: false,
      traceId: 'trace-123',
    });
  });

  it('forwards i18n args to ProblemCatalog for dynamic title/detail', () => {
    const result = toProblemDetails(
      createDomainFailure({
        kind: 'rate_limited',
        code: 'AUTH_VERIFICATION_CODE_COOLDOWN',
        args: { minutes: 5 },
        retryAfter: 300,
      }),
      { catalog, lang: 'zh-CN' },
    );

    expect(result).toMatchObject({
      code: 'AUTH_VERIFICATION_CODE_COOLDOWN',
      title:
        'translated:common.problem_auth_verification_code_cooldown_title:{"minutes":5}',
      detail:
        'translated:common.problem_auth_verification_code_cooldown_detail:{"minutes":5}',
      retryAfter: 300,
    });
  });

  it('forwards safe validation and retry metadata but omits cause', () => {
    const result = toProblemDetails(
      createDomainFailure({
        kind: 'validation',
        code: 'VALIDATION_FAILED',
        errors: { date: ['Use YYYY-MM-DD.'] },
        retryAfter: 2,
      }),
      { catalog, lang: 'zh-CN' },
    );

    expect(result).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: { date: ['Use YYYY-MM-DD.'] },
      retryAfter: 2,
    });
    expect(result).not.toHaveProperty('cause');
  });

  it('rejects a malformed or undocumented failure at the mapper seam', () => {
    expect(() =>
      toProblemDetails(
        {
          _tag: 'DomainFailure',
          kind: 'internal',
          code: 'NOT_IN_CATALOG',
        } as never,
        { catalog, lang: 'en' },
      ),
    ).toThrow(DomainFailureException);
  });
});
