import type { ArgumentsHost } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ResultCode } from '../api-envelope';
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

  it('logs internal errors with request metadata and request id', () => {
    const logger = {
      error: jest.fn(),
      warn: jest.fn(),
      setContext: jest.fn(),
    };
    const requestContext = {
      getRequestId: jest.fn().mockReturnValue('req-500'),
    };
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = {
      method: 'GET',
      originalUrl: '/api/v1/test',
      url: '/api/v1/test',
    };
    const filter = new ApiExceptionFilter(
      logger as never,
      requestContext as never,
    );

    filter.catch(new Error('boom'), createHost(response, request));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-500',
        method: 'GET',
        path: '/api/v1/test',
        statusCode: 500,
      }),
      expect.stringContaining('Unhandled exception'),
    );
    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: ResultCode.INTERNAL_ERROR,
      }),
    );
  });

  it('logs http exceptions as warnings with request metadata', () => {
    const logger = {
      error: jest.fn(),
      warn: jest.fn(),
      setContext: jest.fn(),
    };
    const requestContext = {
      getRequestId: jest.fn().mockReturnValue('req-400'),
    };
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = {
      method: 'POST',
      originalUrl: '/api/v1/items',
      url: '/api/v1/items',
    };
    const filter = new ApiExceptionFilter(
      logger as never,
      requestContext as never,
    );

    filter.catch(
      new HttpException(
        { code: ResultCode.BAD_REQUEST, message: 'bad input' },
        HttpStatus.BAD_REQUEST,
      ),
      createHost(response, request),
    );

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-400',
        method: 'POST',
        path: '/api/v1/items',
        statusCode: 400,
      }),
      expect.stringContaining('Handled exception'),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});
