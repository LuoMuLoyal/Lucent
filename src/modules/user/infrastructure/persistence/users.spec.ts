/**
 * `PrismaUsers` mapping tests.
 *
 * These assertions used to live in `user.service.spec.ts`, back when the service
 * issued the queries itself. They test **storage semantics**, not use-case
 * behaviour, so they moved here with the queries:
 *
 * - reads go through the `nonDeleted` scope (soft-deleted rows are invisible);
 * - a P2002 unique violation surfaces as `RESOURCE_CONFLICT` rather than escaping
 *   as an unhandled error — concurrent same-email registrations rely on that;
 * - any other Prisma error is re-thrown unchanged so it reaches the global
 *   filter with its original shape;
 * - `softDelete` always writes the `status`/`deletedAt` pair together.
 */
import type { DeepMocked } from '../../../../common/types/deep-mocked.js';
import { Prisma, UserStatus } from '#generated/prisma/client.js';
import { nonDeleted } from '../../../../common/index.js';
import { PrismaUsers } from './users.js';
import type { PrismaService } from '../../../../prisma/index.js';

const mockUser = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  status: UserStatus.active,
  ...nonDeleted,
};

describe('PrismaUsers', () => {
  let users: PrismaUsers;
  let prisma: DeepMocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      nonDeleted: {
        user: {
          findFirst: vi.fn(),
        },
      },
    } as unknown as DeepMocked<PrismaService>;
    users = new PrismaUsers(prisma);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads through the nonDeleted scope by id', async () => {
    prisma.nonDeleted.user.findFirst.mockResolvedValue(mockUser);

    await expect(users.findById('user-uuid-1')).resolves.toEqual(mockUser);
    expect(prisma.nonDeleted.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'user-uuid-1' },
    });
  });

  it('reads through the nonDeleted scope by email', async () => {
    prisma.nonDeleted.user.findFirst.mockResolvedValue(mockUser);

    await users.findByEmail('test@example.com');

    expect(prisma.nonDeleted.user.findFirst).toHaveBeenCalledWith({
      where: { email: 'test@example.com' },
    });
  });

  it('backfills an empty profile when create omits one', async () => {
    prisma.user.create.mockResolvedValue(mockUser);

    await users.create({ email: 'test@example.com' });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { email: 'test@example.com', profile: { create: {} } },
    });
  });

  it('preserves an explicitly provided profile relation', async () => {
    prisma.user.create.mockResolvedValue(mockUser);

    await users.create({
      email: 'test@example.com',
      profile: { create: { locale: 'zh-CN' } },
    });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'test@example.com',
        profile: { create: { locale: 'zh-CN' } },
      },
    });
  });

  it('maps a P2002 unique violation to RESOURCE_CONFLICT', async () => {
    const error = Object.create(Prisma.PrismaClientKnownRequestError.prototype);
    error.code = 'P2002';
    prisma.user.create.mockRejectedValue(error);

    const result = await users.create({ email: 'duplicate@example.com' });

    result.match(
      () => {
        throw new Error('expected a failure');
      },
      (failure) => {
        expect(failure).toMatchObject({
          kind: 'conflict',
          code: 'RESOURCE_CONFLICT',
        });
      },
    );
  });

  it('rethrows an unknown database error unchanged', async () => {
    const error = new Error('connection reset');
    prisma.user.create.mockRejectedValue(error);

    await expect(users.create({ email: 'x@example.com' })).rejects.toBe(error);
  });

  it('writes status and deletedAt together on soft delete', async () => {
    prisma.user.update.mockResolvedValue(mockUser);
    const at = new Date('2026-10-25T00:00:00Z');

    await users.softDelete('user-uuid-1', at);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-uuid-1' },
      data: { status: UserStatus.deleted, deletedAt: at },
    });
  });

  it('reports the status of a non-deleted user only', async () => {
    prisma.user.findFirst.mockResolvedValue({ status: UserStatus.active });

    await expect(users.findStatus('user-uuid-1')).resolves.toEqual({
      status: UserStatus.active,
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'user-uuid-1', status: { not: UserStatus.deleted } },
      select: { status: true },
    });
  });
});
