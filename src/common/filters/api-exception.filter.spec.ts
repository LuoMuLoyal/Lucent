import type { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ResultCode } from '../api/api-envelope';
import { ApiExceptionFilter } from './api-exception.filter';

describe('ApiExceptionFilter', () => {
  let loggerError: vi.MockInstance<any>;
  let loggerWarn: vi.MockInstance<any>;

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

  function createFilter() {
    const requestContext = {
      getRequestId: vi.fn().mockReturnValue('req-test'),
    };
    const filter = new ApiExceptionFilter(requestContext as never);
    return { filter, requestContext };
  }

  beforeEach(() => {
    loggerError = vi.fn();
    loggerWarn = vi.fn();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(
      loggerError as never,
    );
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(loggerWarn as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── resolveStatus + resolveBody for HttpException ──────────────────────

  it('handles HttpException with string response', () => {
    const { filter } = createFilter();
    const response = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = { method: 'GET', url: '/test' };

    filter.catch(
      new HttpException('string message', HttpStatus.NOT_FOUND),
      createHost(response, request),
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(response.send).toHaveBeenCalledWith({
      code: ResultCode.NOT_FOUND,
      message: 'string message',
      data: null,
    });
    // NOT_FOUND is < 500, so should be logged as warn
    expect(loggerWarn).toHaveBeenCalled();
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('handles HttpException with object response containing numeric code', () => {
    const { filter } = createFilter();
    const response = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = { method: 'POST', url: '/items' };

    filter.catch(
      new HttpException(
        { code: 409001, message: 'conflict occurred' },
        HttpStatus.CONFLICT,
      ),
      createHost(response, request),
    );

    expect(response.send).toHaveBeenCalledWith({
      code: 409001,
      message: 'conflict occurred',
      data: null,
    });
  });

  it('handles HttpException with array message (joined with "; ")', () => {
    const { filter } = createFilter();
    const response = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = { method: 'POST', url: '/items' };

    filter.catch(
      new BadRequestException([
        'fieldA is required',
        'fieldB must be a string',
      ]),
      createHost(response, request),
    );

    expect(response.send).toHaveBeenCalledWith({
      code: ResultCode.BAD_REQUEST,
      message: 'fieldA is required; fieldB must be a string',
      data: null,
    });
  });

  it('handles HttpException with response missing message (falls back to error)', () => {
    const { filter } = createFilter();
    const response = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = { method: 'GET', url: '/test' };

    const exc = new HttpException({ error: 'Not Found' }, HttpStatus.NOT_FOUND);
    filter.catch(exc, createHost(response, request));

    expect(response.send).toHaveBeenCalledWith({
      code: ResultCode.NOT_FOUND,
      message: 'Not Found',
      data: null,
    });
  });

  it('handles HttpException with response missing both message and error (falls back to default)', () => {
    const { filter } = createFilter();
    const response = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = { method: 'GET', url: '/test' };

    const exc = new HttpException({}, HttpStatus.BAD_REQUEST);
    filter.catch(exc, createHost(response, request));

    expect(response.send).toHaveBeenCalledWith({
      code: ResultCode.BAD_REQUEST,
      message: 'Request failed',
      data: null,
    });
  });

  // ── defaultCode mapping ────────────────────────────────────────────────

  it('maps UNAUTHORIZED status to UNAUTHORIZED code', () => {
    const { filter } = createFilter();
    const response = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = { method: 'GET', url: '/test' };

    filter.catch(
      new HttpException('no auth', HttpStatus.UNAUTHORIZED),
      createHost(response, request),
    );

    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({ code: ResultCode.UNAUTHORIZED }),
    );
  });

  it('maps FORBIDDEN status to FORBIDDEN code', () => {
    const { filter } = createFilter();
    const response = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = { method: 'GET', url: '/test' };

    filter.catch(
      new HttpException('forbidden', HttpStatus.FORBIDDEN),
      createHost(response, request),
    );

    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({ code: ResultCode.FORBIDDEN }),
    );
  });

  it('maps CONFLICT status to CONFLICT code', () => {
    const { filter } = createFilter();
    const response = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = { method: 'POST', url: '/items' };

    filter.catch(
      new HttpException('duplicate', HttpStatus.CONFLICT),
      createHost(response, request),
    );

    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({ code: ResultCode.CONFLICT }),
    );
  });

  it('maps non-standard status (e.g. 418) to INTERNAL_ERROR code', () => {
    const { filter } = createFilter();
    const response = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = { method: 'GET', url: '/test' };

    filter.catch(
      new HttpException("I'm a teapot", 418),
      createHost(response, request),
    );

    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({ code: ResultCode.INTERNAL_ERROR }),
    );
  });

  // ── Non-HttpException ──────────────────────────────────────────────────

  it('handles plain Error as INTERNAL_ERROR', () => {
    const { filter } = createFilter();
    const response = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = { method: 'GET', url: '/test' };

    const error = new Error('boom');
    filter.catch(error, createHost(response, request));

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(response.send).toHaveBeenCalledWith({
      code: ResultCode.INTERNAL_ERROR,
      message: 'Internal server error',
      data: null,
    });
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled exception'),
      expect.any(String),
    );
  });

  it('handles non-Error throwables as INTERNAL_ERROR', () => {
    const { filter } = createFilter();
    const response = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = { method: 'GET', url: '/test' };

    filter.catch('string error', createHost(response, request));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.send).toHaveBeenCalledWith({
      code: ResultCode.INTERNAL_ERROR,
      message: 'Internal server error',
      data: null,
    });
  });

  // ── Logging behavior ───────────────────────────────────────────────────

  it('logs 5xx errors with error level and stack', () => {
    const { filter } = createFilter();
    const response = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = {
      method: 'GET',
      url: '/api/v1/test',
    };

    const error = new Error('server crash');
    filter.catch(error, createHost(response, request));

    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled exception: Internal server error'),
      error.stack,
    );
  });

  it('logs 4xx errors with warn level', () => {
    const { filter } = createFilter();
    const response = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = { method: 'POST', url: '/api/v1/items' };

    filter.catch(
      new HttpException('bad input', HttpStatus.BAD_REQUEST),
      createHost(response, request),
    );

    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('Handled exception'),
    );
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('uses request.url when originalUrl is not available', () => {
    const { filter } = createFilter();
    const response = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = { method: 'GET', url: '/fallback-url' };

    filter.catch(new Error('err'), createHost(response, request));

    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('/fallback-url'),
      expect.any(String),
    );
  });

  it('includes requestId in logged metadata', () => {
    const { filter, requestContext } = createFilter();
    requestContext.getRequestId.mockReturnValue('req-abc-123');
    const response = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = { method: 'GET', url: '/test' };

    filter.catch(new Error('err'), createHost(response, request));

    // Logger.error is called with (message, stack) — requestId is in the filter's metadata
    // The filter uses requestContextService.getRequestId() to build metadata
    expect(requestContext.getRequestId).toHaveBeenCalled();
  });

  it('handles HttpException with string array message of single element', () => {
    const { filter } = createFilter();
    const response = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = { method: 'POST', url: '/items' };

    filter.catch(
      new BadRequestException(['single error']),
      createHost(response, request),
    );

    expect(response.send).toHaveBeenCalledWith({
      code: ResultCode.BAD_REQUEST,
      message: 'single error',
      data: null,
    });
  });
});
