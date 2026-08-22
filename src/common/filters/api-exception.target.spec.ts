import type { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { I18nService } from 'nestjs-i18n';
import { createDomainFailure } from '../result/domain-failure';
import { DomainFailureException } from '../result/unwrap-result';
import { ApiExceptionFilter } from './api-exception.filter';

function createI18n(): I18nService {
  const translations: Record<string, string> = {
    'common.problem_internal_error_title': 'Internal server error',
    'common.problem_internal_error_detail': 'Internal server error',
    'common.problem_validation_failed_title': 'Validation failed',
    'common.problem_validation_failed_detail': 'Validation failed',
  };
  return {
    t: vi.fn((key: string) => translations[key] ?? key),
  } as unknown as I18nService;
}

describe('ApiExceptionFilter target contract', () => {
  function createHost(
    response: Partial<FastifyReply>,
    request: object,
  ): ArgumentsHost {
    return {
      getType: () => 'http',
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as ArgumentsHost;
  }

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes Problem Details with application/problem+json for a domain error', () => {
    const filter = new ApiExceptionFilter(createI18n());
    const response = {
      status: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    filter.catch(
      new HttpException(
        {
          type: 'https://api.lumos.example/problems/record-already-exists',
          title: 'Record conflict',
          detail: 'A record already exists for this date.',
          code: 'RECORD_ALREADY_EXISTS',
          retryable: false,
        },
        HttpStatus.CONFLICT,
      ),
      createHost(response, { method: 'POST', url: '/items' }),
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(response.type).toHaveBeenCalledWith('application/problem+json');
    expect(response.send).toHaveBeenCalledWith({
      type: 'https://api.lumos.example/problems/record-already-exists',
      title: 'Record conflict',
      detail: 'A record already exists for this date.',
      code: 'RECORD_ALREADY_EXISTS',
      retryable: false,
    });
  });

  it('maps a folded DomainFailure through the Problem Details filter', () => {
    const filter = new ApiExceptionFilter(createI18n());
    const response = {
      status: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    filter.catch(
      new DomainFailureException(
        createDomainFailure({
          kind: 'not_found',
          code: 'RESOURCE_NOT_FOUND',
        }),
      ),
      createHost(response, { method: 'GET', url: '/account' }),
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(response.type).toHaveBeenCalledWith('application/problem+json');
    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }),
    );
  });

  it('normalizes validation arrays into safe structured errors', () => {
    const filter = new ApiExceptionFilter(createI18n());
    const response = {
      status: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    filter.catch(
      new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: ['email must be an email', 'name should not be empty'],
      }),
      createHost(response, { method: 'POST', url: '/items' }),
    );

    expect(response.type).toHaveBeenCalledWith('application/problem+json');
    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'VALIDATION_FAILED',
        errors: {
          general: ['email must be an email', 'name should not be empty'],
        },
      }),
    );
  });

  it('maps unknown exceptions to a safe internal Problem Details body', () => {
    const filter = new ApiExceptionFilter(createI18n());
    const response = {
      status: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    filter.catch(
      new Error('database password must not leak'),
      createHost(response, { method: 'GET', url: '/items' }),
    );

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(response.type).toHaveBeenCalledWith('application/problem+json');
    expect(response.send).toHaveBeenCalledWith({
      type: 'https://api.lumos.example/problems/internal-error',
      title: 'Internal server error',
      detail: 'Internal server error',
      code: 'INTERNAL_ERROR',
      retryable: false,
    });
  });

  it('preserves a safe string detail from a framework HttpException', () => {
    const filter = new ApiExceptionFilter(createI18n());
    const response = {
      status: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    filter.catch(
      new HttpException('The report share has expired.', HttpStatus.NOT_FOUND),
      createHost(response, { method: 'GET', url: '/reports/share/token' }),
    );

    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'RESOURCE_NOT_FOUND',
        detail: 'The report share has expired.',
      }),
    );
  });

  it('does not translate a retired numeric code into a stable business code', () => {
    const filter = new ApiExceptionFilter(createI18n());
    const response = {
      status: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    filter.catch(
      new HttpException(
        { code: 401002, message: 'legacy token expired' },
        HttpStatus.UNAUTHORIZED,
      ),
      createHost(response, { method: 'GET', url: '/account' }),
    );

    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'AUTH_REQUIRED',
        type: 'https://api.lumos.example/problems/auth-required',
      }),
    );
  });

  it('uses localized catalog title and detail for a stable code', () => {
    const i18n = {
      t: vi.fn(
        (key: string, options?: { lang?: string }) =>
          `${key}@${options?.lang ?? 'missing'}`,
      ),
    };
    const filter = new ApiExceptionFilter(i18n as never);
    const response = {
      status: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    filter.catch(
      new HttpException(
        { code: 'AUTH_TOKEN_EXPIRED' },
        HttpStatus.UNAUTHORIZED,
      ),
      createHost(response, { method: 'GET', url: '/account' }),
    );

    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'AUTH_TOKEN_EXPIRED',
        title: 'common.problem_auth_token_expired_title@en',
        detail: 'common.problem_auth_token_expired_detail@en',
      }),
    );
  });

  it('writes Retry-After when the problem declares a retry delay', () => {
    const filter = new ApiExceptionFilter(createI18n());
    const response = {
      status: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    filter.catch(
      new HttpException(
        {
          code: 'AUTH_LOGIN_RATE_LIMITED',
          retryable: true,
          retryAfter: 120,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
      createHost(response, { method: 'POST', url: '/login' }),
    );

    expect(response.header).toHaveBeenCalledWith('Retry-After', '120');
    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({ retryAfter: 120 }),
    );
  });
});
