import type { DeepMocked } from '../../../common/types/deep-mocked';
import { Prisma } from '#generated/prisma/client';
import { UserStatus } from '#generated/prisma/client';
import type { DomainFailure, ResultAsync } from '../../../common/result';
import { AuthAccountRepository } from './account.repository';
import type { PrismaService } from '../../../prisma';

async function inspectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

describe('AuthAccountRepository', () => {
  let repository: AuthAccountRepository;
  let prisma: DeepMocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      user: { update: vi.fn().mockResolvedValue(undefined) },
    } as unknown as DeepMocked<PrismaService>;
    repository = new AuthAccountRepository(prisma);
  });

  describe('softDeleteUser', () => {
    it('updates user with deletedAt and deleted status', async () => {
      const deletedAt = new Date('2026-07-10T12:00:00.000Z');
      const result = await inspectResult(
        repository.softDeleteUser('user-1', deletedAt),
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { deletedAt, status: UserStatus.deleted },
      });
      expect(result).toMatchObject({ ok: true, value: undefined });
    });

    it('maps a missing user to RESOURCE_NOT_FOUND', async () => {
      const error = Object.create(
        Prisma.PrismaClientKnownRequestError.prototype,
      );
      error.code = 'P2025';
      prisma.user.update = vi.fn().mockRejectedValue(error);

      const result = await inspectResult(
        repository.softDeleteUser('missing-user', new Date()),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });

    it('rethrows an unknown database error', async () => {
      const error = new Error('connection lost');
      prisma.user.update = vi.fn().mockRejectedValue(error);

      await expect(
        repository.softDeleteUser('user-1', new Date()).match(
          () => undefined,
          () => undefined,
        ),
      ).rejects.toBe(error);
    });
  });
});
