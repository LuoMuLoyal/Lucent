import { Test, type TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { type ExecutionContext, type CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { SlowRequestInterceptor } from './slow-request.interceptor';

describe('SlowRequestInterceptor', () => {
  let interceptor: SlowRequestInterceptor;

  let loggerWarn: vi.MockInstance<any>;

  let configGet: vi.MockInstance<any>;

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
          useValue: { setContext: vi.fn(), warn: vi.fn(), info: vi.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: vi.fn() },
        },
      ],
    }).compile();

    interceptor = module.get(SlowRequestInterceptor);
    const logger = module.get(PinoLogger);
    const config = module.get(ConfigService);
    loggerWarn = vi.spyOn(logger, 'warn');
    configGet = vi.spyOn(config, 'get');

    // Reflectors default: no skip metadata
    vi.spyOn(interceptor['reflector'], 'getAllAndOverride').mockReturnValue(
      undefined,
    );
  });

  it('does not warn when request is fast', () =>
    new Promise<void>((resolve) => {
      configGet.mockReturnValue(2000);

      interceptor
        .intercept(createMockContext(), createMockCallHandler())
        .subscribe({
          next: () => {
            expect(loggerWarn).not.toHaveBeenCalled();
            resolve();
          },
        });
    }));

  it('warns when request exceeds threshold', () =>
    new Promise<void>((resolve) => {
      configGet.mockReturnValue(0); // threshold 0 → always slow

      interceptor
        .intercept(createMockContext(), createMockCallHandler())
        .subscribe({
          next: () => {
            expect(loggerWarn).toHaveBeenCalledTimes(1);
            const logData = loggerWarn.mock.calls[0]![0] as Record<
              string,
              unknown
            >;
            expect(logData['method']).toBe('GET');
            expect(logData['path']).toBe('/api/v1/medicines');
            expect(logData['handler']).toBe('MedicinesController');
            resolve();
          },
        });
    }));

  it('skips when @SkipSlowRequestLog metadata is set', () =>
    new Promise<void>((resolve) => {
      vi.spyOn(interceptor['reflector'], 'getAllAndOverride').mockReturnValue(
        true,
      );
      configGet.mockReturnValue(0);

      interceptor
        .intercept(createMockContext(), createMockCallHandler())
        .subscribe({
          next: () => {
            expect(loggerWarn).not.toHaveBeenCalled();
            resolve();
          },
        });
    }));

  it('logs POST method and handler name when slow', () =>
    new Promise<void>((resolve) => {
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
          const logData = loggerWarn.mock.calls[0]![0] as Record<
            string,
            unknown
          >;
          expect(logData['method']).toBe('POST');
          expect(logData['path']).toBe('/api/v1/auth/login');
          expect(logData['handler']).toBe('AuthController');
          resolve();
        },
      });
    }));

  it('includes durationMs and threshold in slow log', () =>
    new Promise<void>((resolve) => {
      configGet.mockReturnValue(0);

      interceptor
        .intercept(createMockContext(), createMockCallHandler())
        .subscribe({
          next: () => {
            const logData = loggerWarn.mock.calls[0]![0] as Record<
              string,
              unknown
            >;
            expect(logData['durationMs']).toEqual(expect.any(Number));
            expect(logData['threshold']).toBe(0);
            resolve();
          },
        });
    }));

  it('uses default threshold when env is not set', () =>
    new Promise<void>((resolve) => {
      configGet.mockReturnValue(undefined);

      interceptor
        .intercept(createMockContext(), createMockCallHandler())
        .subscribe({
          next: () => {
            // Fast request with default 2000ms threshold → no warn
            expect(loggerWarn).not.toHaveBeenCalled();
            resolve();
          },
        });
    }));
});
