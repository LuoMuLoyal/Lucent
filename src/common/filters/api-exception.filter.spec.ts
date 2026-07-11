import type { ArgumentsHost } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ResultCode } from '../api/api-envelope';
import { ApiExceptionFilter } from './api-exception.filter';

describe('ApiExceptionFilter', () => {
  function createHost(
    response: Partial<Response>,
    request: object,
  ): ArgumentsHost {
    return {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as ArgumentsHost;
  }

  function createFilter() {
    const logger = {
      error: jest.fn(),
      warn: jest.fn(),
      setContext: jest.fn(),
    };
    const requestContext = {
      getRequestId: jest.fn().mockReturnValue('req-test'),
    };
    const filter = new ApiExceptionFilter(
      logger as never,
      requestContext as never,
    );
    return { filter, logger, requestContext };
  }

  // ── resolveStatus + resolveBody for HttpException ──────────────────────

  it('handles HttpException with string response', () => {
    const { filter, logger } = createFilter();
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = { method: 'GET', url: '/test' };

    filter.catch(
      new HttpException('string message', HttpStatus.NOT_FOUND),
      createHost(response, request),
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(response.json).toHaveBeenCalledWith({
      code: ResultCode.NOT_FOUND,
      message: 'string message',
      data: null,
    });
    // NOT_FOUND is < 500, so should be logged as warn
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('handles HttpException with object response containing numeric code', () => {
    const { filter } = createFilter();
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = { method: 'POST', url: '/items' };

    filter.catch(
      new HttpException(
        { code: 409001, message: 'conflict occurred' },
        HttpStatus.CONFLICT,
      ),
      createHost(response, request),
    );

    expect(response.json).toHaveBeenCalledWith({
      code: 409001,
      message: 'conflict occurred',
      data: null,
    });
  });

  it('handles HttpException with array message (joined with "; ")', () => {
    const { filter } = createFilter();
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = { method: 'POST', url: '/items' };

    filter.catch(
      new BadRequestException([
        'fieldA is required',
        'fieldB must be a string',
      ]),
      createHost(response, request),
    );

    expect(response.json).toHaveBeenCalledWith({
      code: ResultCode.BAD_REQUEST,
      message: 'fieldA is required; fieldB must be a string',
      data: null,
    });
  });

  it('handles HttpException with response missing message (falls back to error)', () => {
    const { filter } = createFilter();
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = { method: 'GET', url: '/test' };

    const exc = new HttpException({ error: 'Not Found' }, HttpStatus.NOT_FOUND);
    filter.catch(exc, createHost(response, request));

    // No "message" key → normalizeMessage falls back to body.error
    expect(response.json).toHaveBeenCalledWith({
      code: ResultCode.NOT_FOUND,
      message: 'Not Found',
      data: null,
    });
  });

  it('handles HttpException with response missing both message and error (falls back to default)', () => {
    const { filter } = createFilter();
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = { method: 'GET', url: '/test' };

    const exc = new HttpException({}, HttpStatus.BAD_REQUEST);
    filter.catch(exc, createHost(response, request));

    // message undefined, error undefined → normalizeMessage returns 'Request failed'
    expect(response.json).toHaveBeenCalledWith({
      code: ResultCode.BAD_REQUEST,
      message: 'Request failed',
      data: null,
    });
  });

  // ── defaultCode mapping ────────────────────────────────────────────────

  it('maps UNAUTHORIZED status to UNAUTHORIZED code', () => {
    const { filter } = createFilter();
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = { method: 'GET', url: '/test' };

    filter.catch(
      new HttpException('no auth', HttpStatus.UNAUTHORIZED),
      createHost(response, request),
    );

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: ResultCode.UNAUTHORIZED }),
    );
  });

  it('maps FORBIDDEN status to FORBIDDEN code', () => {
    const { filter } = createFilter();
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = { method: 'GET', url: '/test' };

    filter.catch(
      new HttpException('forbidden', HttpStatus.FORBIDDEN),
      createHost(response, request),
    );

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: ResultCode.FORBIDDEN }),
    );
  });

  it('maps CONFLICT status to CONFLICT code', () => {
    const { filter } = createFilter();
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = { method: 'POST', url: '/items' };

    filter.catch(
      new HttpException('duplicate', HttpStatus.CONFLICT),
      createHost(response, request),
    );

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: ResultCode.CONFLICT }),
    );
  });

  it('maps non-standard status (e.g. 418) to INTERNAL_ERROR code', () => {
    const { filter } = createFilter();
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = { method: 'GET', url: '/test' };

    filter.catch(
      new HttpException("I'm a teapot", 418),
      createHost(response, request),
    );

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: ResultCode.INTERNAL_ERROR }),
    );
  });

  // ── Non-HttpException ──────────────────────────────────────────────────

  it('handles plain Error as INTERNAL_ERROR', () => {
    const { filter, logger } = createFilter();
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = { method: 'GET', url: '/test' };

    filter.catch(new Error('boom'), createHost(response, request));

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(response.json).toHaveBeenCalledWith({
      code: ResultCode.INTERNAL_ERROR,
      message: 'Internal server error',
      data: null,
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        err: expect.any(Error),
      }),
      expect.stringContaining('Unhandled exception'),
    );
  });

  it('handles non-Error throwables as INTERNAL_ERROR', () => {
    const { filter } = createFilter();
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = { method: 'GET', url: '/test' };

    filter.catch('string error', createHost(response, request));

    expect(response.status).toHaveBeenCalledWith(500);
    // err should be undefined for non-Error
    expect(response.json).toHaveBeenCalledWith({
      code: ResultCode.INTERNAL_ERROR,
      message: 'Internal server error',
      data: null,
    });
  });

  // ── Logging behavior ───────────────────────────────────────────────────

  it('logs 5xx errors with err property and error level', () => {
    const { filter, logger } = createFilter();
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = {
      method: 'GET',
      originalUrl: '/api/v1/test',
      url: '/test',
    };

    const error = new Error('server crash');
    filter.catch(error, createHost(response, request));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: error,
        statusCode: 500,
        path: '/api/v1/test',
      }),
      'Unhandled exception: Internal server error',
    );
  });

  it('logs 4xx errors with warn level and no err property', () => {
    const { filter, logger } = createFilter();
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = { method: 'POST', url: '/api/v1/items' };

    filter.catch(
      new BadRequestException('bad input'),
      createHost(response, request),
    );

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        method: 'POST',
      }),
      expect.stringContaining('Handled exception'),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('uses request.url when originalUrl is not available', () => {
    const { filter, logger } = createFilter();
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = { method: 'GET', url: '/fallback-url' };

    filter.catch(new Error('err'), createHost(response, request));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/fallback-url' }),
      expect.any(String),
    );
  });

  it('includes requestId in logged metadata', () => {
    const { filter, logger, requestContext } = createFilter();
    requestContext.getRequestId.mockReturnValue('req-abc-123');
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = { method: 'GET', url: '/test' };

    filter.catch(new Error('err'), createHost(response, request));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-abc-123' }),
      expect.any(String),
    );
  });

  it('handles HttpException with string array message of single element', () => {
    const { filter } = createFilter();
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = { method: 'POST', url: '/items' };

    filter.catch(
      new BadRequestException(['single error']),
      createHost(response, request),
    );

    expect(response.json).toHaveBeenCalledWith({
      code: ResultCode.BAD_REQUEST,
      message: 'single error',
      data: null,
    });
  });
});

// Helper import
import { BadRequestException } from '@nestjs/common';
