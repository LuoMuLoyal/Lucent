import type { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiExceptionFilter } from './api-exception.filter';

describe('ApiExceptionFilter target contract', () => {
  function createHost(
    response: Partial<FastifyReply>,
    request: object,
  ): ArgumentsHost {
    return {
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
    const filter = new ApiExceptionFilter();
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

  it('normalizes validation arrays into safe structured errors', () => {
    const filter = new ApiExceptionFilter();
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
    const filter = new ApiExceptionFilter();
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
    });
  });
});
