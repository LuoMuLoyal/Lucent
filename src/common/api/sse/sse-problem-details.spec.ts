import { HttpException, HttpStatus } from '@nestjs/common';
import { ProblemCatalog } from '../problem-catalog';
import { SseProblemDetailsMapper } from './sse-problem-details';

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
});
