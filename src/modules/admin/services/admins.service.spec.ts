import { AdminRole, UserStatus } from '#generated/prisma/client.js';
import { okAsync } from '../../../common/result/index.js';
import type { PrismaService } from '../../../prisma/index.js';
import type { AuditLogService } from '../../audit-log/index.js';
import { AdminAdminsService } from './admins.service.js';

const grantRow = {
  userId: 'target-1',
  role: AdminRole.ADMIN,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-02T00:00:00.000Z'),
  user: {
    email: 'target@example.com',
    nickname: 'Target',
    status: UserStatus.active,
  },
};

describe('AdminAdminsService', () => {
  function buildService() {
    const adminUser = {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    };
    const user = { findFirst: vi.fn() };
    const prisma = { adminUser, user } as unknown as PrismaService;
    const audit = { log: vi.fn().mockReturnValue(okAsync(undefined)) };
    const service = new AdminAdminsService(
      prisma,
      audit as unknown as AuditLogService,
    );
    return { service, adminUser, user, audit };
  }

  describe('setRole', () => {
    it('refuses to change the caller\'s own role', async () => {
      const { service, adminUser } = buildService();

      await expect(
        service.setRole('actor-1', 'actor-1', AdminRole.ADMIN),
      ).resolves.toEqual({ status: 'self' });
      expect(adminUser.upsert).not.toHaveBeenCalled();
    });

    it('reports an unknown target user', async () => {
      const { service, user, adminUser } = buildService();
      user.findFirst.mockResolvedValue(null);

      await expect(
        service.setRole('actor-1', 'missing', AdminRole.ADMIN),
      ).resolves.toEqual({ status: 'user_not_found' });
      expect(adminUser.upsert).not.toHaveBeenCalled();
    });

    it('refuses to demote the last super administrator', async () => {
      const { service, user, adminUser, audit } = buildService();
      user.findFirst.mockResolvedValue({ id: 'target-1' });
      adminUser.findUnique.mockResolvedValue({ role: AdminRole.SUPER_ADMIN });
      adminUser.count.mockResolvedValue(0);

      await expect(
        service.setRole('actor-1', 'target-1', AdminRole.VIEWER),
      ).resolves.toEqual({ status: 'last_super_admin' });
      expect(adminUser.upsert).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('promotes a user and records before/after roles', async () => {
      const { service, user, adminUser, audit } = buildService();
      user.findFirst.mockResolvedValue({ id: 'target-1' });
      adminUser.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(grantRow);

      await expect(
        service.setRole('actor-1', 'target-1', AdminRole.ADMIN),
      ).resolves.toEqual({
        status: 'ok',
        admin: {
          userId: 'target-1',
          email: 'target@example.com',
          nickname: 'Target',
          userStatus: UserStatus.active,
          role: AdminRole.ADMIN,
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-02T00:00:00.000Z',
        },
      });
      expect(adminUser.upsert).toHaveBeenCalledWith({
        where: { userId: 'target-1' },
        create: { userId: 'target-1', role: AdminRole.ADMIN },
        update: { role: AdminRole.ADMIN },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'actor-1',
          action: 'admin.admins.role.set',
          resourceId: 'target-1',
          metadata: { before: null, after: AdminRole.ADMIN },
        }),
      );
    });

    it('allows demoting a super administrator when another remains', async () => {
      const { service, user, adminUser } = buildService();
      user.findFirst.mockResolvedValue({ id: 'target-1' });
      adminUser.findUnique
        .mockResolvedValueOnce({ role: AdminRole.SUPER_ADMIN })
        .mockResolvedValueOnce({ ...grantRow, role: AdminRole.VIEWER });
      adminUser.count.mockResolvedValue(1);

      await expect(
        service.setRole('actor-1', 'target-1', AdminRole.VIEWER),
      ).resolves.toMatchObject({ status: 'ok' });
      expect(adminUser.upsert).toHaveBeenCalledOnce();
    });
  });

  describe('remove', () => {
    it('refuses to remove the caller\'s own grant', async () => {
      const { service, adminUser } = buildService();

      await expect(service.remove('actor-1', 'actor-1')).resolves.toBe('self');
      expect(adminUser.delete).not.toHaveBeenCalled();
    });

    it('reports a missing grant', async () => {
      const { service, adminUser } = buildService();
      adminUser.findUnique.mockResolvedValue(null);

      await expect(service.remove('actor-1', 'target-1')).resolves.toBe(
        'not_found',
      );
    });

    it('refuses to remove the last super administrator', async () => {
      const { service, adminUser } = buildService();
      adminUser.findUnique.mockResolvedValue({ role: AdminRole.SUPER_ADMIN });
      adminUser.count.mockResolvedValue(0);

      await expect(service.remove('actor-1', 'target-1')).resolves.toBe(
        'last_super_admin',
      );
      expect(adminUser.delete).not.toHaveBeenCalled();
    });

    it('removes a grant and records the audit entry', async () => {
      const { service, adminUser, audit } = buildService();
      adminUser.findUnique.mockResolvedValue({ role: AdminRole.VIEWER });

      await expect(service.remove('actor-1', 'target-1')).resolves.toBe('ok');
      expect(adminUser.delete).toHaveBeenCalledWith({
        where: { userId: 'target-1' },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin.admins.remove',
          resourceId: 'target-1',
          metadata: { before: AdminRole.VIEWER, after: null },
        }),
      );
    });
  });

  describe('isSuperAdmin', () => {
    it('is true only for SUPER_ADMIN', async () => {
      const { service, adminUser } = buildService();
      adminUser.findUnique.mockResolvedValueOnce({
        role: AdminRole.SUPER_ADMIN,
      });
      await expect(service.isSuperAdmin('user-1')).resolves.toBe(true);

      adminUser.findUnique.mockResolvedValueOnce({ role: AdminRole.ADMIN });
      await expect(service.isSuperAdmin('user-2')).resolves.toBe(false);

      adminUser.findUnique.mockResolvedValueOnce(null);
      await expect(service.isSuperAdmin('user-3')).resolves.toBe(false);
    });
  });
});
