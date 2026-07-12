import type { DeepMocked } from '../../../common/types/deep-mocked';
import { UserStatus } from '#generated/prisma/client';
import { AuthAccountRepository } from './account.repository';
import type { PrismaService } from '../../../prisma/prisma.service';

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
      await repository.softDeleteUser('user-1', deletedAt);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { deletedAt, status: UserStatus.deleted },
      });
    });
  });
});
