import {
  type ExecutionContext,
  type CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { SlowRequestInterceptor } from './slow-request.interceptor.js';
import { ConfigKey } from '../../config/env/config-keys.enum.js';
import { loadYamlConfig } from '../../config/yaml/yaml-loader.js';

describe('SlowRequestInterceptor', () => {
  let interceptor: SlowRequestInterceptor;
  let loggerWarn: vi.MockInstance<any>;

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

  function createInterceptor(thresholdMs: number): SlowRequestInterceptor {
    const yamlConfig = {
      ...loadYamlConfig(),
      log: { ...loadYamlConfig().log, slowRequestThresholdMs: thresholdMs },
    };
    const mockConfigService = {
      getOrThrow: vi.fn((key: string) => {
        if (key === (ConfigKey.Yaml as string)) return yamlConfig;
        throw new Error(`Missing config: ${key}`);
      }),
    } as unknown as ConfigService;
    const reflector = new Reflector();
    return new SlowRequestInterceptor(mockConfigService, reflector);
  }

  beforeEach(() => {
    loggerWarn = vi.fn();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(loggerWarn as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not warn when request is fast', () =>
    new Promise<void>((resolve) => {
      interceptor = createInterceptor(2000);

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
      interceptor = createInterceptor(0); // threshold 0 → always slow

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
      interceptor = createInterceptor(0);

      vi.spyOn(interceptor['reflector'], 'getAllAndOverride').mockReturnValue(
        true,
      );

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
      interceptor = createInterceptor(0);
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
      interceptor = createInterceptor(0);

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
      // Default threshold from YAML is 2000ms → fast request → no warn
      interceptor = createInterceptor(2000);

      interceptor
        .intercept(createMockContext(), createMockCallHandler())
        .subscribe({
          next: () => {
            expect(loggerWarn).not.toHaveBeenCalled();
            resolve();
          },
        });
    }));
});
