import { HttpException, HttpStatus } from '@nestjs/common';
import { ProblemCatalog } from '../problem-catalog.js';
import { SseProblemDetailsMapper } from './sse-problem-details.js';
import { createDomainFailure } from '../../result/index.js';
import { DomainFailureException } from '../../result/domain-failure.exception.js';

describe('SseProblemDetailsMapper', () => {
  function createMapper(): SseProblemDetailsMapper {
    const i18n = {
      t: vi.fn((key: string) => key),
    };
    return new SseProblemDetailsMapper(new ProblemCatalog(i18n as never));
  }

  it('builds a localized target error event without HTTP duplicate fields', () => {
    const mapper = createMapper();

    expect(
      mapper.build(
        new HttpException(
          { code: 'AUTH_TOKEN_EXPIRED' },
          HttpStatus.UNAUTHORIZED,
        ),
        { lang: 'zh-CN', status: 'client_error' },
      ),
    ).toEqual({
      type: 'https://api.lumos.example/problems/auth-token-expired',
      title: 'common.problem_auth_token_expired_title',
      detail: 'common.problem_auth_token_expired_detail',
      code: 'AUTH_TOKEN_EXPIRED',
      retryable: false,
      status: 'client_error',
    });
  });

  it('maps unknown failures to safe server errors', () => {
    const mapper = createMapper();

    expect(
      mapper.build(new Error('database password must not leak'), {
        lang: 'en',
      }),
    ).toEqual({
      type: 'https://api.lumos.example/problems/internal-error',
      title: 'common.problem_internal_error_title',
      detail: 'common.problem_internal_error_detail',
      code: 'INTERNAL_ERROR',
      retryable: false,
      status: 'server_error',
    });
  });

  it('rejects numeric legacy error codes instead of serializing them', () => {
    const mapper = createMapper();

    const payload = mapper.build(
      new HttpException(
        { code: 401002, message: 'legacy token expired' },
        HttpStatus.UNAUTHORIZED,
      ),
      { lang: 'en' },
    );

    expect(payload.code).toBe('AUTH_REQUIRED');
    expect(payload).not.toHaveProperty('statusCode');
  });

  it('maps a DomainFailureException to a safe client error payload', () => {
    const mapper = createMapper();

    const payload = mapper.build(
      new DomainFailureException(
        createDomainFailure({
          kind: 'not_found',
          code: 'RESOURCE_NOT_FOUND',
          detail: 'Conversation not found.',
          cause: new Error('root cause must not leak'),
        }),
      ),
      { lang: 'en' },
    );

    expect(payload).toEqual({
      type: 'https://api.lumos.example/problems/resource-not-found',
      title: 'common.problem_resource_not_found_title',
      detail: 'Conversation not found.',
      code: 'RESOURCE_NOT_FOUND',
      retryable: false,
      status: 'client_error',
    });
    expect(payload).not.toHaveProperty('statusCode');
    expect(payload).not.toHaveProperty('traceId');
    expect(payload).not.toHaveProperty('cause');
    expect(payload).not.toHaveProperty('stack');
  });

  it('maps a raw DomainFailure to a safe payload with retryable/retryAfter', () => {
    const mapper = createMapper();

    const payload = mapper.build(
      createDomainFailure({
        kind: 'dependency',
        code: 'DEPENDENCY_TIMEOUT',
        retryable: true,
        retryAfter: 30,
      }),
      { lang: 'en' },
    );

    expect(payload).toEqual({
      type: 'https://api.lumos.example/problems/dependency-timeout',
      title: 'common.problem_dependency_timeout_title',
      detail: 'common.problem_dependency_timeout_detail',
      code: 'DEPENDENCY_TIMEOUT',
      retryable: true,
      retryAfter: 30,
      status: 'server_error',
    });
  });

  it('maps dependency and internal failures to server_error status', () => {
    const mapper = createMapper();

    const dependency = mapper.build(
      new DomainFailureException(
        createDomainFailure({
          kind: 'dependency',
          code: 'DEPENDENCY_UNAVAILABLE',
        }),
      ),
      { lang: 'en' },
    );
    const internal = mapper.build(
      new DomainFailureException(
        createDomainFailure({ kind: 'internal', code: 'INTERNAL_ERROR' }),
      ),
      { lang: 'en' },
    );

    expect(dependency.status).toBe('server_error');
    expect(internal.status).toBe('server_error');
  });

  it('respects an explicit transport status option', () => {
    const mapper = createMapper();

    const payload = mapper.build(
      new DomainFailureException(
        createDomainFailure({
          kind: 'conflict',
          code: 'RESOURCE_CONFLICT',
        }),
      ),
      { lang: 'en', status: 'cancelled' },
    );

    expect(payload.code).toBe('RESOURCE_CONFLICT');
    expect(payload.status).toBe('cancelled');
  });
});
