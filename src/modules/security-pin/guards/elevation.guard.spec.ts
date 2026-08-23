import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import type { ExecutionContext } from '@nestjs/common';

import { SecurityElevationGuard } from './elevation.guard';
import { SecurityPinService } from '../services/pin.service';
import { REQUIRE_SECURITY_ELEVATION_KEY } from '../decorators/require-elevation.decorator';
import type { SecurityElevationPayload } from '../types/elevation.types';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
} from '../../../common/result';

function createMockContext(
  options: {
    handlerMetadata?: boolean;
    classMetadata?: boolean;
    headers?: Record<string, string | string[] | undefined>;
    user?: { sub: string; email: string };
  } = {},
): ExecutionContext {
  const handler = function ProtectedHandler() {};
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  const controllerClass = class ProtectedController {};

  if (options.handlerMetadata) {
    Reflect.defineMetadata(REQUIRE_SECURITY_ELEVATION_KEY, true, handler);
  }
  if (options.classMetadata) {
    Reflect.defineMetadata(
      REQUIRE_SECURITY_ELEVATION_KEY,
      true,
      controllerClass,
    );
  }

  return {
    getHandler: () => handler,
    getClass: () => controllerClass,
    switchToHttp: () => ({
      getRequest: () => ({
        headers: options.headers ?? {},
        user: options.user ?? {
          sub: 'user-1',
          email: 'a@b.c',
          status: 'active',
        },
      }),
    }),
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

describe('SecurityElevationGuard', () => {
  let guard: SecurityElevationGuard;
  let securityPinService: vi.Mocked<SecurityPinService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecurityElevationGuard,
        {
          provide: SecurityPinService,
          useValue: {
            verifyElevationToken: vi.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get(SecurityElevationGuard);
    securityPinService = module.get(SecurityPinService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('allows requests without the decorator to pass through', async () => {
    const context = createMockContext();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(securityPinService.verifyElevationToken).not.toHaveBeenCalled();
  });

  it('accepts a valid elevation token with matching version and subject', async () => {
    const payload: SecurityElevationPayload = {
      sub: 'user-1',
      scope: 'security_elevation',
      version: 3,
    };
    securityPinService.verifyElevationToken.mockReturnValue(okAsync(payload));

    const context = createMockContext({
      handlerMetadata: true,
      headers: { 'x-security-elevation': 'Bearer valid-token' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(securityPinService.verifyElevationToken).toHaveBeenCalledWith(
      'valid-token',
      'user-1',
    );
  });

  it('rejects when the elevation header is missing', async () => {
    const context = createMockContext({ handlerMetadata: true });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      name: 'DomainFailureException',
      failure: { code: 'AUTH_ELEVATION_TOKEN_INVALID' },
    });
  });

  it('rejects when the elevation header is not a Bearer token', async () => {
    const context = createMockContext({
      handlerMetadata: true,
      headers: { 'x-security-elevation': 'valid-token' },
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      name: 'DomainFailureException',
      failure: { code: 'AUTH_ELEVATION_TOKEN_INVALID' },
    });
  });

  it('rejects when the user has no subject', async () => {
    const context = createMockContext({
      handlerMetadata: true,
      headers: { 'x-security-elevation': 'Bearer valid-token' },
      user: { sub: '', email: 'a@b.c' },
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      name: 'DomainFailureException',
      failure: { code: 'AUTH_REQUIRED' },
    });
  });

  it('folds an invalid-token service failure into DomainFailureException', async () => {
    securityPinService.verifyElevationToken.mockReturnValue(
      errAsync(
        createDomainFailure({
          kind: 'authentication',
          code: 'AUTH_ELEVATION_TOKEN_INVALID',
        }),
      ),
    );

    const context = createMockContext({
      handlerMetadata: true,
      headers: { 'x-security-elevation': 'Bearer bad-token' },
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      name: 'DomainFailureException',
      failure: { code: 'AUTH_ELEVATION_TOKEN_INVALID' },
    });
  });

  it('passes through an elevation-required failure (stale version) as AUTH_ELEVATION_REQUIRED', async () => {
    securityPinService.verifyElevationToken.mockReturnValue(
      errAsync(
        createDomainFailure({
          kind: 'authentication',
          code: 'AUTH_ELEVATION_REQUIRED',
        }),
      ),
    );

    const context = createMockContext({
      handlerMetadata: true,
      headers: { 'x-security-elevation': 'Bearer stale-token' },
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      name: 'DomainFailureException',
      failure: { code: 'AUTH_ELEVATION_REQUIRED' },
    });
  });

  it('propagates unknown service errors instead of disguising them as elevation failures', async () => {
    securityPinService.verifyElevationToken.mockReturnValue(
      fromPromise(Promise.reject(new Error('db connection lost')), (error) => {
        throw error;
      }),
    );

    const context = createMockContext({
      handlerMetadata: true,
      headers: { 'x-security-elevation': 'Bearer token' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'db connection lost',
    );
  });
});
