import { AdminRole } from '#generated/prisma/client.js';
import type { PrismaService } from '../../../prisma/index.js';
import { AdminAccessService } from './access.service.js';

describe('AdminAccessService', () => {
  const findUnique = vi.fn();
  let service: AdminAccessService;

  beforeEach(() => {
    findUnique.mockReset();
    service = new AdminAccessService({
      adminUser: { findUnique },
    } as unknown as PrismaService);
  });

  it('returns the current admin identity with server-derived permissions', async () => {
    findUnique.mockResolvedValue({
      role: AdminRole.EDITOR,
      user: {
        id: 'user-1',
        email: 'editor@example.com',
        nickname: 'Editor',
        avatar: null,
      },
    });

    await expect(service.getIdentity('user-1')).resolves.toEqual({
      id: 'user-1',
      email: 'editor@example.com',
      nickname: 'Editor',
      avatar: null,
      role: AdminRole.EDITOR,
      permissions: ['content:read', 'content:write'],
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: {
        role: true,
        user: {
          select: { id: true, email: true, nickname: true, avatar: true },
        },
      },
    });
  });

  it('returns null if the admin role was revoked', async () => {
    findUnique.mockResolvedValue(null);

    await expect(service.getIdentity('user-1')).resolves.toBeNull();
  });
});
