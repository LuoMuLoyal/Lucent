import { Prisma } from '#generated/prisma/client.js';
import { okAsync } from '../../../../common/result/index.js';
import type { PrismaService } from '../../../../prisma/index.js';
import type { AuditLogService } from '../../../audit-log/index.js';
import { getAdminResource } from '../../constants/resource-registry.js';
import { AdminDataService } from './data.service.js';

function knownRequestError(code: string): Error {
  const error = Object.create(
    Prisma.PrismaClientKnownRequestError.prototype,
  ) as Error & { code: string };
  error.code = code;
  return error;
}

const users = getAdminResource('users')!;
const userSessions = getAdminResource('user-sessions')!;
const userSettings = getAdminResource('user-settings')!;
const auditLogs = getAdminResource('audit-logs')!;

describe('AdminDataService', () => {
  function buildService() {
    const user = {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const userSession = {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const userSetting = {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const prisma = { user, userSession, userSetting } as unknown as PrismaService;
    const audit = { log: vi.fn().mockReturnValue(okAsync(undefined)) };
    const service = new AdminDataService(
      prisma,
      audit as unknown as AuditLogService,
    );
    return { service, user, userSession, userSetting, audit };
  }

  describe('list', () => {
    it('injects the soft-delete filter and paginates', async () => {
      const { service, user } = buildService();
      user.findMany.mockResolvedValue([{ id: 'u1' }]);
      user.count.mockResolvedValue(1);

      const page = await service.list(users, { page: 2, limit: 10, order: 'desc' });

      expect(user.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip: 10,
        take: 10,
      });
      expect(user.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
      expect(page).toEqual({
        items: [{ id: 'u1' }],
        total: 1,
        page: 2,
        limit: 10,
      });
    });

    it('adds a case-insensitive search across search fields', async () => {
      const { service, user } = buildService();
      user.findMany.mockResolvedValue([]);
      user.count.mockResolvedValue(0);

      await service.list(users, { page: 1, limit: 25, order: 'desc', q: 'ada' });

      expect(user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            OR: [
              { email: { contains: 'ada', mode: 'insensitive' } },
              { nickname: { contains: 'ada', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('filters by userId only when the resource exposes it', async () => {
      const { service, user, userSession } = buildService();
      userSession.findMany.mockResolvedValue([]);
      userSession.count.mockResolvedValue(0);
      user.findMany.mockResolvedValue([]);
      user.count.mockResolvedValue(0);

      await service.list(userSessions, {
        page: 1,
        limit: 25,
        order: 'desc',
        userId: '00000000-0000-0000-0000-000000000000',
      });
      expect(userSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: '00000000-0000-0000-0000-000000000000',
          },
        }),
      );

      await service.list(users, {
        page: 1,
        limit: 25,
        order: 'desc',
        userId: '00000000-0000-0000-0000-000000000000',
      });
      expect(user.count).toHaveBeenLastCalledWith({
        where: { deletedAt: null },
      });
    });

    it('omits sensitive columns from rows', async () => {
      const { service, userSession } = buildService();
      userSession.findMany.mockResolvedValue([
        { id: 's1', refreshTokenHash: 'secret', deviceName: 'phone' },
      ]);
      userSession.count.mockResolvedValue(1);

      const page = await service.list(userSessions, {
        page: 1,
        limit: 25,
        order: 'desc',
      });

      expect(page.items).toEqual([{ id: 's1', deviceName: 'phone' }]);
      expect(page.items[0]).not.toHaveProperty('refreshTokenHash');
    });

    it('rejects an unsortable field', async () => {
      const { service } = buildService();
      await expect(
        service.list(users, {
          page: 1,
          limit: 25,
          order: 'desc',
          sort: 'password',
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('getOne', () => {
    it('returns null when nothing matches', async () => {
      const { service, user } = buildService();
      user.findFirst.mockResolvedValue(null);
      await expect(service.getOne(users, 'missing')).resolves.toBeNull();
    });

    it('sanitizes the row it returns', async () => {
      const { service, userSession } = buildService();
      userSession.findFirst.mockResolvedValue({
        id: 's1',
        refreshTokenHash: 'x',
      });
      await expect(service.getOne(userSessions, 's1')).resolves.toEqual({
        id: 's1',
      });
    });
  });

  describe('create', () => {
    it('filters to the writable allowlist and audits field names', async () => {
      const { service, user, audit } = buildService();
      user.create.mockResolvedValue({ id: 'u1', nickname: 'ada' });

      await expect(
        service.create('actor-1', users, { nickname: 'ada' }),
      ).resolves.toEqual({ id: 'u1', nickname: 'ada' });
      expect(user.create).toHaveBeenCalledWith({ data: { nickname: 'ada' } });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'actor-1',
          action: 'admin.data.create',
          resourceType: 'users',
          resourceId: 'u1',
          metadata: { fields: ['id', 'nickname'] },
        }),
      );
    });

    it('rejects an undeclared column', async () => {
      const { service, user } = buildService();
      await expect(
        service.create('actor-1', users, { height: 180 }),
      ).rejects.toMatchObject({ status: 400 });
      expect(user.create).not.toHaveBeenCalled();
    });

    it('rejects an omitted sensitive column', async () => {
      const { service } = buildService();
      await expect(
        service.create('actor-1', userSessions, { refreshTokenHash: 'x' }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects an empty body', async () => {
      const { service } = buildService();
      await expect(service.create('actor-1', users, {})).rejects.toMatchObject({
        status: 400,
      });
    });

    it('refuses read-only resources', async () => {
      const { service } = buildService();
      await expect(
        service.create('actor-1', auditLogs, { action: 'x' }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('translates a unique-constraint violation into a conflict', async () => {
      const { service, user } = buildService();
      user.create.mockRejectedValue(knownRequestError('P2002'));
      await expect(
        service.create('actor-1', users, { email: 'ada@example.com' }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('update', () => {
    it('returns null when the row is missing', async () => {
      const { service, user, audit } = buildService();
      user.findFirst.mockResolvedValue(null);
      await expect(
        service.update('actor-1', users, 'missing', { nickname: 'x' }),
      ).resolves.toBeNull();
      expect(user.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('updates by the resource id field', async () => {
      const { service, user } = buildService();
      user.findFirst.mockResolvedValue({ id: 'u1' });
      user.update.mockResolvedValue({ id: 'u1', nickname: 'new' });

      await expect(
        service.update('actor-1', users, 'u1', { nickname: 'new' }),
      ).resolves.toEqual({ id: 'u1', nickname: 'new' });
      expect(user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { nickname: 'new' },
      });
    });
  });

  describe('remove', () => {
    it('soft-deletes a soft-delete table', async () => {
      const { service, user } = buildService();
      user.findFirst.mockResolvedValue({ id: 'u1' });
      user.update.mockResolvedValue({ id: 'u1' });

      await expect(service.remove('actor-1', users, 'u1')).resolves.toBe(true);
      expect(user.delete).not.toHaveBeenCalled();
      expect(user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('hard-deletes other tables', async () => {
      const { service, userSetting } = buildService();
      userSetting.findFirst.mockResolvedValue({ id: 's1' });
      userSetting.delete.mockResolvedValue({ id: 's1' });

      await expect(
        service.remove('actor-1', userSettings, 's1'),
      ).resolves.toBe(true);
      expect(userSetting.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    });

    it('returns false when the row is missing', async () => {
      const { service, user } = buildService();
      user.findFirst.mockResolvedValue(null);
      await expect(service.remove('actor-1', users, 'missing')).resolves.toBe(
        false,
      );
    });

    it('refuses read-only resources', async () => {
      const { service } = buildService();
      await expect(
        service.remove('actor-1', auditLogs, 'a1'),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('unknown model', () => {
    it('rejects a registry entry Prisma does not expose', async () => {
      const { service } = buildService();
      const rogue = { ...users, model: 'ghost' };
      await expect(
        service.list(rogue, { page: 1, limit: 25, order: 'desc' }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});
