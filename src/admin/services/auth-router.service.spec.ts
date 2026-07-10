/* eslint-disable @typescript-eslint/no-unsafe-call */
import type { ConfigService } from '@nestjs/config';
import { buildAdminAuthRouter } from './auth-router.service';

describe('buildAdminAuthRouter', () => {
  let mockAdmin: unknown;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockBuildAuthenticatedRouter: jest.Mock;

  beforeEach(() => {
    mockAdmin = { name: 'AdminJS' };
    mockConfigService = {
      getOrThrow: jest.fn(),
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;
    mockBuildAuthenticatedRouter = jest
      .fn()
      .mockReturnValue({ name: 'router' });
  });

  it('reads email, password, and cookie secret from config', () => {
    mockConfigService.getOrThrow
      .mockReturnValueOnce('admin@test.com')
      .mockReturnValueOnce('secret-pass')
      .mockReturnValueOnce('cookie-secret');
    mockConfigService.get.mockReturnValue('development');

    buildAdminAuthRouter(
      mockAdmin,
      mockConfigService,
      mockBuildAuthenticatedRouter as never,
    );

    expect(mockConfigService.getOrThrow).toHaveBeenCalledWith('ADMIN_EMAIL');
    expect(mockConfigService.getOrThrow).toHaveBeenCalledWith('ADMIN_PASSWORD');
    expect(mockConfigService.getOrThrow).toHaveBeenCalledWith(
      'ADMIN_COOKIE_SECRET',
    );
  });

  it('passes authenticate function that returns user on correct credentials', () => {
    mockConfigService.getOrThrow
      .mockReturnValueOnce('admin@test.com')
      .mockReturnValueOnce('secret-pass')
      .mockReturnValueOnce('cookie-secret');
    mockConfigService.get.mockReturnValue('development');

    buildAdminAuthRouter(
      mockAdmin,
      mockConfigService,
      mockBuildAuthenticatedRouter as never,
    );

    const authConfig = mockBuildAuthenticatedRouter.mock.calls[0]?.[1];
    const authenticate = authConfig?.authenticate;

    expect(authenticate('admin@test.com', 'secret-pass')).toEqual({
      email: 'admin@test.com',
    });
    expect(authenticate('wrong@test.com', 'secret-pass')).toBeNull();
    expect(authenticate('admin@test.com', 'wrong-pass')).toBeNull();
  });

  it('sets cookie secure flag to true in production', () => {
    mockConfigService.getOrThrow
      .mockReturnValueOnce('admin@test.com')
      .mockReturnValueOnce('secret-pass')
      .mockReturnValueOnce('cookie-secret');
    mockConfigService.get.mockReturnValue('production');

    buildAdminAuthRouter(
      mockAdmin,
      mockConfigService,
      mockBuildAuthenticatedRouter as never,
    );

    const sessionOptions = mockBuildAuthenticatedRouter.mock.calls[0]?.[3];
    expect(sessionOptions?.cookie?.secure).toBe(true);
  });

  it('sets cookie secure flag to false in non-production', () => {
    mockConfigService.getOrThrow
      .mockReturnValueOnce('admin@test.com')
      .mockReturnValueOnce('secret-pass')
      .mockReturnValueOnce('cookie-secret');
    mockConfigService.get.mockReturnValue('development');

    buildAdminAuthRouter(
      mockAdmin,
      mockConfigService,
      mockBuildAuthenticatedRouter as never,
    );

    const sessionOptions = mockBuildAuthenticatedRouter.mock.calls[0]?.[3];
    expect(sessionOptions?.cookie?.secure).toBe(false);
  });

  it('sets cookie name and cookiePassword correctly', () => {
    mockConfigService.getOrThrow
      .mockReturnValueOnce('admin@test.com')
      .mockReturnValueOnce('secret-pass')
      .mockReturnValueOnce('cookie-secret');
    mockConfigService.get.mockReturnValue('development');

    buildAdminAuthRouter(
      mockAdmin,
      mockConfigService,
      mockBuildAuthenticatedRouter as never,
    );

    const authConfig = mockBuildAuthenticatedRouter.mock.calls[0]?.[1];
    expect(authConfig?.cookieName).toBe('lucent-admin');
    expect(authConfig?.cookiePassword).toBe('cookie-secret');

    const sessionOptions = mockBuildAuthenticatedRouter.mock.calls[0]?.[3];
    expect(sessionOptions?.secret).toBe('cookie-secret');
    expect(sessionOptions?.name).toBe('lucent-admin');
  });

  it('returns the router from buildAuthenticatedRouter', () => {
    mockConfigService.getOrThrow
      .mockReturnValueOnce('admin@test.com')
      .mockReturnValueOnce('secret-pass')
      .mockReturnValueOnce('cookie-secret');
    mockConfigService.get.mockReturnValue('development');

    const result = buildAdminAuthRouter(
      mockAdmin,
      mockConfigService,
      mockBuildAuthenticatedRouter as never,
    );

    expect(result).toEqual({ name: 'router' });
  });
});
