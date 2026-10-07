import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { UserPayload } from '../../auth/index.js';
import type { AdminAccessService } from '../services/access.service.js';
import { AdminPermissionGuard } from './admin-permission.guard.js';

const user: UserPayload = {
  sub: 'user-1',
  email: 'admin@example.com',
  status: 'active',
};

function buildContext(authenticatedUser?: UserPayload): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: authenticatedUser }) }),
    getHandler: () => Object,
    getClass: () => Object,
  } as unknown as ExecutionContext;
}

describe('AdminPermissionGuard', () => {
  let reflector: vi.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
  let access: vi.Mocked<Pick<AdminAccessService, 'getRole' | 'can'>>;
  let guard: AdminPermissionGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: vi.fn() };
    access = { getRole: vi.fn(), can: vi.fn() };
    guard = new AdminPermissionGuard(
      reflector as unknown as Reflector,
      access as unknown as AdminAccessService,
    );
  });

  it('rejects missing authenticated identity with 401', async () => {
    await expect(
      guard.canActivate(buildContext()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(access.getRole).not.toHaveBeenCalled();
  });

  it('distinguishes a missing admin role from insufficient permission', async () => {
    access.getRole.mockResolvedValue(null);

    await expect(
      guard.canActivate(buildContext(user)),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FORBIDDEN' }),
    });
    expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
  });

  it('returns INSUFFICIENT_PERMISSION when the role lacks the requested permission', async () => {
    access.getRole.mockResolvedValue('VIEWER');
    reflector.getAllAndOverride.mockReturnValue('content:write');
    access.can.mockReturnValue(false);

    await expect(
      guard.canActivate(buildContext(user)),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INSUFFICIENT_PERMISSION' }),
    });
    expect(access.can).toHaveBeenCalledWith('VIEWER', 'content:write');
  });

  it('fails closed when no permission metadata is declared', async () => {
    access.getRole.mockResolvedValue('ADMIN');
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(
      guard.canActivate(buildContext(user)),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INSUFFICIENT_PERMISSION' }),
    });
    expect(access.can).not.toHaveBeenCalled();
  });

  it('allows a role with the requested permission', async () => {
    access.getRole.mockResolvedValue('ADMIN');
    reflector.getAllAndOverride.mockReturnValue('metrics:read');
    access.can.mockReturnValue(true);

    await expect(
      guard.canActivate(buildContext(user)),
    ).resolves.toBe(true);
  });
});
