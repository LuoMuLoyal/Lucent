import { Test, type TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { type ExecutionContext, type CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { SlowRequestInterceptor } from './slow-request.interceptor';

describe('SlowRequestInterceptor', () => {
  let interceptor: SlowRequestInterceptor;
  let loggerWarn: jest.SpyInstance;
  let configGet: jest.SpyInstance;

  const mockRequest = {
    method: 'GET',
    originalUrl: '/api/v1/medicines',
    url: '/api/v1/medicines',
  };

  function createMockContext(
    handlerName = 'MedicinesController',
  ): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => mockRequest }),
      getClass: () => ({ name: handlerName }),
      getHandler: () => ({}),
    } as unknown as ExecutionContext;
  }

  function createMockCallHandler(): CallHandler {
    return { handle: () => of(undefined) };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlowRequestInterceptor,
        Reflector,
        {
          provide: PinoLogger,
          useValue: { setContext: jest.fn(), warn: jest.fn(), info: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    interceptor = module.get(SlowRequestInterceptor);
    const logger = module.get(PinoLogger);
    const config = module.get(ConfigService);
    loggerWarn = jest.spyOn(logger, 'warn');
    configGet = jest.spyOn(config, 'get');

    // Reflectors default: no skip metadata
    jest
      .spyOn(interceptor['reflector'], 'getAllAndOverride')
      .mockReturnValue(undefined);
  });

  it('does not warn when request is fast', (done) => {
    configGet.mockReturnValue(2000);

    interceptor
      .intercept(createMockContext(), createMockCallHandler())
      .subscribe({
        next: () => {
          expect(loggerWarn).not.toHaveBeenCalled();
          done();
        },
      });
  });

  it('warns when request exceeds threshold', (done) => {
    configGet.mockReturnValue(0); // threshold 0 → always slow

    interceptor
      .intercept(createMockContext(), createMockCallHandler())
      .subscribe({
        next: () => {
          expect(loggerWarn).toHaveBeenCalledTimes(1);
          const logData = loggerWarn.mock.calls[0][0];
          expect(logData.method).toBe('GET');
          expect(logData.path).toBe('/api/v1/medicines');
          expect(logData.handler).toBe('MedicinesController');
          done();
        },
      });
  });

  it('skips when @SkipSlowRequestLog metadata is set', (done) => {
    jest
      .spyOn(interceptor['reflector'], 'getAllAndOverride')
      .mockReturnValue(true);
    configGet.mockReturnValue(0);

    interceptor
      .intercept(createMockContext(), createMockCallHandler())
      .subscribe({
        next: () => {
          expect(loggerWarn).not.toHaveBeenCalled();
          done();
        },
      });
  });

  it('logs POST method and handler name when slow', (done) => {
    configGet.mockReturnValue(0);
    const ctx = createMockContext('AuthController');
    const postReq = {
      method: 'POST',
      originalUrl: '/api/v1/auth/login',
      url: '/api/v1/auth/login',
    };
    // Override the mock request for this test
    ctx.switchToHttp = () => ({ getRequest: () => postReq }) as never;

    interceptor.intercept(ctx, createMockCallHandler()).subscribe({
      next: () => {
        expect(loggerWarn).toHaveBeenCalledTimes(1);
        const logData = loggerWarn.mock.calls[0][0];
        expect(logData.method).toBe('POST');
        expect(logData.path).toBe('/api/v1/auth/login');
        expect(logData.handler).toBe('AuthController');
        done();
      },
    });
  });

  it('includes durationMs and threshold in slow log', (done) => {
    configGet.mockReturnValue(0);

    interceptor
      .intercept(createMockContext(), createMockCallHandler())
      .subscribe({
        next: () => {
          const logData = loggerWarn.mock.calls[0][0];
          expect(logData.durationMs).toEqual(expect.any(Number));
          expect(logData.threshold).toBe(0);
          done();
        },
      });
  });

  it('uses default threshold when env is not set', (done) => {
    configGet.mockReturnValue(undefined);

    interceptor
      .intercept(createMockContext(), createMockCallHandler())
      .subscribe({
        next: () => {
          // Fast request with default 2000ms threshold → no warn
          expect(loggerWarn).not.toHaveBeenCalled();
          done();
        },
      });
  });
});
