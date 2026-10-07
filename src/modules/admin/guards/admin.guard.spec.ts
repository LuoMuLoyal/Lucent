import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { UserPayload } from '../../auth/index.js';
import type { AdminAccessService } from '../services/access.service.js';
import { AdminGuard } from './admin.guard.js';

const adminUser = { sub: 'user-1', email: 'admin@example.com', status: 'active' };

function buildContext(user?: UserPayload): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  let access: vi.Mocked<Pick<AdminAccessService, 'getRole'>>;
  let guard: AdminGuard;

  beforeEach(() => {
    access = { getRole: vi.fn() };
    guard = new AdminGuard(access as unknown as AdminAccessService);
  });

  it('rejects missing authenticated identity with 401', async () => {
    await expect(guard.canActivate(buildContext())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(access.getRole).not.toHaveBeenCalled();
  });

  it('rejects authenticated users without an AdminUser role with 403', async () => {
    access.getRole.mockResolvedValue(null);

    await expect(
      guard.canActivate(buildContext(adminUser as UserPayload)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(access.getRole).toHaveBeenCalledWith(adminUser.sub);
  });

  it('allows any user with an AdminUser role', async () => {
    access.getRole.mockResolvedValue('VIEWER');

    await expect(
      guard.canActivate(buildContext(adminUser as UserPayload)),
    ).resolves.toBe(true);
  });
});
