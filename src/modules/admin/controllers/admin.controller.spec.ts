import { ForbiddenException } from '@nestjs/common';
import { AdminRole } from '#generated/prisma/client.js';
import type { UserPayload } from '../../auth/index.js';
import type { AdminAccessService } from '../services/access.service.js';
import { AdminController } from './admin.controller.js';

const user: UserPayload = {
  sub: 'user-1',
  email: 'editor@example.com',
  status: 'active',
};

const identity = {
  id: 'user-1',
  email: 'editor@example.com',
  nickname: 'Editor',
  avatar: null,
  role: AdminRole.EDITOR,
  permissions: ['content:read', 'content:write'],
};

describe('AdminController', () => {
  it('returns the current role and permissions', async () => {
    const adminAccess = {
      getIdentity: vi.fn().mockResolvedValue(identity),
    } as unknown as AdminAccessService;
    const controller = new AdminController(adminAccess);

    await expect(controller.getMe(user)).resolves.toEqual(identity);
    expect(adminAccess.getIdentity).toHaveBeenCalledWith(user.sub);
  });

  it('fails closed if the admin role is revoked between guard and query', async () => {
    const adminAccess = {
      getIdentity: vi.fn().mockResolvedValue(null),
    } as unknown as AdminAccessService;
    const controller = new AdminController(adminAccess);

    await expect(controller.getMe(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
