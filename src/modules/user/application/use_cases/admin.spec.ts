import { UserStatus } from '#generated/prisma/client.js';
import { okAsync } from '../../../../common/result/index.js';
import type { UserRepositoryPort } from '../ports/users.js';
import type { AuditLogService } from '../../../audit-log/index.js';
import { UserAdminService } from './admin.js';

describe('UserAdminService', () => {
  function buildService() {
    const users = {
      findStatus: vi.fn(),
      setStatus: vi.fn(),
      softDelete: vi.fn(),
    };
    const audit = { log: vi.fn().mockReturnValue(okAsync(undefined)) };
    const service = new UserAdminService(
      users as unknown as UserRepositoryPort,
      audit as unknown as AuditLogService,
    );
    return { service, users, audit };
  }

  describe('setStatus', () => {
    it('returns null for an unknown or deleted user', async () => {
      const { service, users, audit } = buildService();
      users.findStatus.mockResolvedValue(null);

      await expect(
        service.setStatus('actor-1', 'missing', UserStatus.suspended),
      ).resolves.toBeNull();
      expect(users.setStatus).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('suspends a user and records before/after status', async () => {
      const { service, users, audit } = buildService();
      users.findStatus.mockResolvedValue({ status: UserStatus.active });
      users.setStatus.mockResolvedValue({ status: UserStatus.suspended });

      await expect(
        service.setStatus('actor-1', 'target-1', UserStatus.suspended),
      ).resolves.toEqual({
        userId: 'target-1',
        before: UserStatus.active,
        after: UserStatus.suspended,
      });
      expect(users.setStatus).toHaveBeenCalledWith(
        'target-1',
        UserStatus.suspended,
      );
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
      const { service, users } = buildService();
      users.findStatus.mockResolvedValue(null);

      await expect(service.softDelete('actor-1', 'missing')).resolves.toBe(
        false,
      );
      expect(users.setStatus).not.toHaveBeenCalled();
    });

    it('marks the user deleted and records the audit entry', async () => {
      const { service, users, audit } = buildService();
      users.findStatus.mockResolvedValue({ status: UserStatus.active });
      users.setStatus.mockResolvedValue({});

      await expect(service.softDelete('actor-1', 'target-1')).resolves.toBe(
        true,
      );
      expect(users.softDelete).toHaveBeenCalledWith(
        'target-1',
        expect.any(Date),
      );
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
