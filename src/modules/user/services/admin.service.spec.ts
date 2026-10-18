import { UserStatus } from '#generated/prisma/client.js';
import { okAsync } from '../../../common/result/index.js';
import type { PrismaService } from '../../../prisma/index.js';
import type { AuditLogService } from '../../audit-log/index.js';
import { UserAdminService } from './admin.service.js';

describe('UserAdminService', () => {
  function buildService() {
    const user = { findFirst: vi.fn(), update: vi.fn() };
    const prisma = { user } as unknown as PrismaService;
    const audit = { log: vi.fn().mockReturnValue(okAsync(undefined)) };
    const service = new UserAdminService(
      prisma,
      audit as unknown as AuditLogService,
    );
    return { service, user, audit };
  }

  describe('setStatus', () => {
    it('returns null for an unknown or deleted user', async () => {
      const { service, user, audit } = buildService();
      user.findFirst.mockResolvedValue(null);

      await expect(
        service.setStatus('actor-1', 'missing', UserStatus.suspended),
      ).resolves.toBeNull();
      expect(user.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('suspends a user and records before/after status', async () => {
      const { service, user, audit } = buildService();
      user.findFirst.mockResolvedValue({ status: UserStatus.active });
      user.update.mockResolvedValue({ status: UserStatus.suspended });

      await expect(
        service.setStatus('actor-1', 'target-1', UserStatus.suspended),
      ).resolves.toEqual({
        userId: 'target-1',
        before: UserStatus.active,
        after: UserStatus.suspended,
      });
      expect(user.update).toHaveBeenCalledWith({
        where: { id: 'target-1' },
        data: { status: UserStatus.suspended },
        select: { status: true },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'actor-1',
          action: 'admin.users.status.update',
          resourceId: 'target-1',
          metadata: {
            before: UserStatus.active,
            after: UserStatus.suspended,
          },
        }),
      );
    });
  });

  describe('softDelete', () => {
    it('returns false for an unknown user', async () => {
      const { service, user } = buildService();
      user.findFirst.mockResolvedValue(null);

      await expect(service.softDelete('actor-1', 'missing')).resolves.toBe(
        false,
      );
      expect(user.update).not.toHaveBeenCalled();
    });

    it('marks the user deleted and records the audit entry', async () => {
      const { service, user, audit } = buildService();
      user.findFirst.mockResolvedValue({ status: UserStatus.active });
      user.update.mockResolvedValue({});

      await expect(service.softDelete('actor-1', 'target-1')).resolves.toBe(
        true,
      );
      expect(user.update).toHaveBeenCalledWith({
        where: { id: 'target-1' },
        data: {
          status: UserStatus.deleted,
          deletedAt: expect.any(Date) as Date,
        },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin.users.delete',
          resourceId: 'target-1',
          metadata: {
            before: UserStatus.active,
            after: UserStatus.deleted,
          },
        }),
      );
    });
  });
});
