import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';

import { SecurityElevationGuard } from './elevation.guard';
import { SecurityPinService } from '../services/pin.service';
import { REQUIRE_SECURITY_ELEVATION_KEY } from '../decorators/require-elevation.decorator';
import type { SecurityElevationPayload } from '../types/elevation.types';

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
  let securityPinService: jest.Mocked<SecurityPinService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecurityElevationGuard,
        {
          provide: SecurityPinService,
          useValue: {
            verifyElevationToken: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get(SecurityElevationGuard);
    securityPinService = module.get(SecurityPinService);
  });

  afterEach(() => {
    jest.clearAllMocks();
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
    securityPinService.verifyElevationToken.mockResolvedValue(payload);

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

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects when the elevation header is not a Bearer token', async () => {
    const context = createMockContext({
      handlerMetadata: true,
      headers: { 'x-security-elevation': 'valid-token' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
