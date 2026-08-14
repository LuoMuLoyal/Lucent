import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { UserPayload } from '../../auth';
import { AdminGuard } from './admin.guard';

const ADMIN_EMAIL = 'admin@lucent.local';

describe('AdminGuard', () => {
  let configService: vi.Mocked<ConfigService>;
  let guard: AdminGuard;

  beforeEach(() => {
    configService = {
      get: vi.fn(),
    } as unknown as vi.Mocked<ConfigService>;
    guard = new AdminGuard(configService);
  });

  function buildContext(user?: UserPayload): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  it('throws 401 when no authenticated user is attached', () => {
    configService.get.mockReturnValue(ADMIN_EMAIL);

    expect(() => guard.canActivate(buildContext())).toThrow(
      UnauthorizedException,
    );
  });

  it('throws 403 when ADMIN_EMAIL is not configured', () => {
    configService.get.mockReturnValue(undefined);

    expect(() =>
      guard.canActivate(
        buildContext({ sub: 'u1', email: ADMIN_EMAIL, status: 'active' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('throws 403 for a regular user', () => {
    configService.get.mockReturnValue(ADMIN_EMAIL);

    expect(() =>
      guard.canActivate(
        buildContext({
          sub: 'u1',
          email: 'user@example.com',
          status: 'active',
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('throws 403 when the user has no email claim', () => {
    configService.get.mockReturnValue(ADMIN_EMAIL);

    expect(() =>
      guard.canActivate(
        buildContext({ sub: 'u1', email: null, status: 'active' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('throws 403 for a case-differing admin email (constant-time exact match)', () => {
    configService.get.mockReturnValue(ADMIN_EMAIL);

    expect(() =>
      guard.canActivate(
        buildContext({
          sub: 'u1',
          email: 'Admin@Lucent.Local',
          status: 'active',
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows the ADMIN_EMAIL user through', () => {
    configService.get.mockReturnValue(ADMIN_EMAIL);

    const result = guard.canActivate(
      buildContext({ sub: 'u1', email: ADMIN_EMAIL, status: 'active' }),
    );

    expect(result).toBe(true);
  });
});
