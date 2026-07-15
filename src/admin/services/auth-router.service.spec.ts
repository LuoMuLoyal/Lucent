/* eslint-disable @typescript-eslint/no-unsafe-call */
import type { ConfigService } from '@nestjs/config';
import { buildAdminAuthRouter } from './auth-router.service';

describe('buildAdminAuthRouter', () => {
  let mockAdmin: unknown;
  let mockConfigService: vi.Mocked<ConfigService>;
  let mockBuildAuthenticatedRouter: vi.Mock;
  let mockFastifyInstance: unknown;

  beforeEach(() => {
    mockAdmin = { name: 'AdminJS' };
    mockConfigService = {
      getOrThrow: vi.fn(),
      get: vi.fn(),
    } as unknown as vi.Mocked<ConfigService>;
    mockBuildAuthenticatedRouter = vi.fn().mockResolvedValue(undefined);
    mockFastifyInstance = { name: 'fastify' };
  });

  it('reads email, password, and cookie secret from config', async () => {
    mockConfigService.getOrThrow
      .mockReturnValueOnce('admin@test.com')
      .mockReturnValueOnce('secret-pass')
      .mockReturnValueOnce('cookie-secret');
    mockConfigService.get.mockReturnValue('development');

    await buildAdminAuthRouter(
      mockAdmin as never,
      mockConfigService,
      mockBuildAuthenticatedRouter as never,
      mockFastifyInstance as never,
    );

    expect(mockConfigService.getOrThrow).toHaveBeenCalledWith('ADMIN_EMAIL');
    expect(mockConfigService.getOrThrow).toHaveBeenCalledWith('ADMIN_PASSWORD');
    expect(mockConfigService.getOrThrow).toHaveBeenCalledWith(
      'ADMIN_COOKIE_SECRET',
    );
  });

  it('passes authenticate function that returns user on correct credentials', async () => {
    mockConfigService.getOrThrow
      .mockReturnValueOnce('admin@test.com')
      .mockReturnValueOnce('secret-pass')
      .mockReturnValueOnce('cookie-secret');
    mockConfigService.get.mockReturnValue('development');

    await buildAdminAuthRouter(
      mockAdmin as never,
      mockConfigService,
      mockBuildAuthenticatedRouter as never,
      mockFastifyInstance as never,
    );

    const authConfig = mockBuildAuthenticatedRouter.mock.calls[0]?.[1];
    const authenticate = authConfig?.authenticate;

    expect(authenticate('admin@test.com', 'secret-pass')).toEqual({
      email: 'admin@test.com',
    });
    expect(authenticate('wrong@test.com', 'secret-pass')).toBeNull();
    expect(authenticate('admin@test.com', 'wrong-pass')).toBeNull();
  });

  it('sets cookie secure flag to true in production', async () => {
    mockConfigService.getOrThrow
      .mockReturnValueOnce('admin@test.com')
      .mockReturnValueOnce('secret-pass')
      .mockReturnValueOnce('cookie-secret');
    mockConfigService.get.mockReturnValue('production');

    await buildAdminAuthRouter(
      mockAdmin as never,
      mockConfigService,
      mockBuildAuthenticatedRouter as never,
      mockFastifyInstance as never,
    );

    const sessionOptions = mockBuildAuthenticatedRouter.mock.calls[0]?.[3];
    expect(sessionOptions?.cookie?.secure).toBe(true);
  });

  it('sets cookie secure flag to false in non-production', async () => {
    mockConfigService.getOrThrow
      .mockReturnValueOnce('admin@test.com')
      .mockReturnValueOnce('secret-pass')
      .mockReturnValueOnce('cookie-secret');
    mockConfigService.get.mockReturnValue('development');

    await buildAdminAuthRouter(
      mockAdmin as never,
      mockConfigService,
      mockBuildAuthenticatedRouter as never,
      mockFastifyInstance as never,
    );

    const sessionOptions = mockBuildAuthenticatedRouter.mock.calls[0]?.[3];
    expect(sessionOptions?.cookie?.secure).toBe(false);
  });

  it('sets cookie name and cookiePassword correctly', async () => {
    mockConfigService.getOrThrow
      .mockReturnValueOnce('admin@test.com')
      .mockReturnValueOnce('secret-pass')
      .mockReturnValueOnce('cookie-secret');
    mockConfigService.get.mockReturnValue('development');

    await buildAdminAuthRouter(
      mockAdmin as never,
      mockConfigService,
      mockBuildAuthenticatedRouter as never,
      mockFastifyInstance as never,
    );

    const authConfig = mockBuildAuthenticatedRouter.mock.calls[0]?.[1];
    expect(authConfig?.cookieName).toBe('lucent-admin');
    expect(authConfig?.cookiePassword).toBe('cookie-secret');
  });

  it('passes fastifyInstance as third argument to buildAuthenticatedRouter', async () => {
    mockConfigService.getOrThrow
      .mockReturnValueOnce('admin@test.com')
      .mockReturnValueOnce('secret-pass')
      .mockReturnValueOnce('cookie-secret');
    mockConfigService.get.mockReturnValue('development');

    await buildAdminAuthRouter(
      mockAdmin as never,
      mockConfigService,
      mockBuildAuthenticatedRouter as never,
      mockFastifyInstance as never,
    );

    expect(mockBuildAuthenticatedRouter.mock.calls[0]?.[2]).toBe(
      mockFastifyInstance,
    );
  });

  it('awaits the buildAuthenticatedRouter promise', async () => {
    mockConfigService.getOrThrow
      .mockReturnValueOnce('admin@test.com')
      .mockReturnValueOnce('secret-pass')
      .mockReturnValueOnce('cookie-secret');
    mockConfigService.get.mockReturnValue('development');

    await buildAdminAuthRouter(
      mockAdmin as never,
      mockConfigService,
      mockBuildAuthenticatedRouter as never,
      mockFastifyInstance as never,
    );

    expect(mockBuildAuthenticatedRouter).toHaveBeenCalledTimes(1);
  });
});
