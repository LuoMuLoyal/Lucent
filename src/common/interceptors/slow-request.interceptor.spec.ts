import { Test, type TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { type ExecutionContext, type CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { SlowRequestInterceptor } from './slow-request.interceptor';

describe('SlowRequestInterceptor', () => {
  let interceptor: SlowRequestInterceptor;
  let loggerWarn: vi.MockInstance<any>;
  let configGet: vi.MockInstance<any>;

  const mockRequest = {
    method: 'GET',
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
    loggerWarn = vi.fn();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(loggerWarn as never);

    configGet = vi.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlowRequestInterceptor,
        Reflector,
        {
          provide: ConfigService,
          useValue: { get: configGet },
        },
      ],
    }).compile();

    interceptor = module.get(SlowRequestInterceptor);

    // Reflectors default: no skip metadata
    vi.spyOn(interceptor['reflector'], 'getAllAndOverride').mockReturnValue(
      undefined,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
            const msg = loggerWarn.mock.calls[0]![0] as string;
            expect(msg).toContain('GET');
            expect(msg).toContain('/api/v1/medicines');
            expect(msg).toContain('MedicinesController');
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
        url: '/api/v1/auth/login',
      };
      ctx.switchToHttp = () => ({ getRequest: () => postReq }) as never;

      interceptor.intercept(ctx, createMockCallHandler()).subscribe({
        next: () => {
          expect(loggerWarn).toHaveBeenCalledTimes(1);
          const msg = loggerWarn.mock.calls[0]![0] as string;
          expect(msg).toContain('POST');
          expect(msg).toContain('/api/v1/auth/login');
          expect(msg).toContain('AuthController');
          resolve();
        },
      });
    }));

  it('includes durationMs and threshold in slow log', () =>
    new Promise<void>((resolve, reject) => {
      configGet.mockReturnValue(0);

      interceptor
        .intercept(createMockContext(), createMockCallHandler())
        .subscribe({
          next: () => {
            try {
              const msg = loggerWarn.mock.calls[0]![0] as string;
              expect(msg).toContain('durationMs=');
              expect(msg).toContain('threshold 0ms');
              resolve();
            } catch (e) {
              reject(e as Error);
            }
          },
          error: (e: unknown) => {
            reject(e as Error);
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
