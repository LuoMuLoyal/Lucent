import type { DeepMocked } from '../../../common/types/deep-mocked';

import { Prisma } from '#generated/prisma/client';
import type { DomainFailure, ResultAsync } from '../../../common/result';
import { UserHealthContextRepository } from './health-context.repository';
import type { PrismaService } from '../../../prisma';

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  const error = Object.create(
    Prisma.PrismaClientKnownRequestError.prototype,
  ) as Prisma.PrismaClientKnownRequestError;
  error.code = code;
  return error;
}

async function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

describe('UserHealthContextRepository', () => {
  let repository: UserHealthContextRepository;
  let prisma: DeepMocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      user: { findFirst: vi.fn() },
      userProfile: { findUnique: vi.fn(), upsert: vi.fn() },
      userAllergy: {
        create: vi.fn(),
        update: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      userCondition: {
        create: vi.fn(),
        update: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      userCurrentMedicine: {
        create: vi.fn(),
        update: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
    } as unknown as DeepMocked<PrismaService>;

    repository = new UserHealthContextRepository(prisma);
  });

  describe('findUserWithHealthContext', () => {
    it('queries user with health context include', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' } as never);

      const result = await repository.findUserWithHealthContext('user-1');

      expect(result).toMatchObject({ id: 'user-1' });
      const call = prisma.user.findFirst.mock.calls[0]?.[0];
      expect(call?.where).toMatchObject({ id: 'user-1', deletedAt: null });
    });

    it('returns null when not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      expect(await repository.findUserWithHealthContext('missing')).toBeNull();
    });
  });

  describe('findProfileByUserId', () => {
    it('queries profile by userId with select', async () => {
      prisma.userProfile.findUnique.mockResolvedValue({
        onboardingCompletedAt: new Date('2026-07-01'),
      } as never);

      const result = await repository.findProfileByUserId('user-1', {
        onboardingCompletedAt: true,
      });

      expect(result).not.toBeNull();
      expect(prisma.userProfile.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: { onboardingCompletedAt: true },
      });
    });
  });

  describe('upsertProfile', () => {
    it('upserts profile with where, create, and update', async () => {
      prisma.userProfile.upsert.mockResolvedValue(undefined as never);

      const result = await collectResult(
        repository.upsertProfile(
          { userId: 'user-1' },
          { userId: 'user-1', heightCm: 170 } as never,
          { heightCm: 175 } as never,
        ),
      );

      expect(result).toEqual({ ok: true, value: undefined });
      expect(prisma.userProfile.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: { userId: 'user-1', heightCm: 170 },
        update: { heightCm: 175 },
      });
    });

    it('maps a unique constraint violation to RESOURCE_CONFLICT', async () => {
      prisma.userProfile.upsert.mockRejectedValue(prismaError('P2002'));

      const result = await collectResult(
        repository.upsertProfile(
          { userId: 'user-1' },
          { userId: 'user-1' } as never,
          { locale: 'en' } as never,
        ),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'conflict', code: 'RESOURCE_CONFLICT' },
      });
    });

    it('rethrows an unknown database error', async () => {
      prisma.userProfile.upsert.mockRejectedValue(new Error('connection lost'));

      await expect(
        repository.upsertProfile(
          { userId: 'user-1' },
          { userId: 'user-1' } as never,
          { locale: 'en' } as never,
        ),
      ).rejects.toThrow('connection lost');
    });
  });

  describe('createAllergy', () => {
    it('creates allergy with provided data', async () => {
      prisma.userAllergy.create.mockResolvedValue(undefined as never);

      const result = await collectResult(
        repository.createAllergy({
          userId: 'user-1',
          allergen: 'pollen',
        } as never),
      );

      expect(result).toEqual({ ok: true, value: undefined });
      expect(prisma.userAllergy.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', allergen: 'pollen' },
      });
    });

    it('maps a unique constraint violation to RESOURCE_CONFLICT', async () => {
      prisma.userAllergy.create.mockRejectedValue(prismaError('P2002'));

      const result = await collectResult(
        repository.createAllergy({
          userId: 'user-1',
          allergen: 'pollen',
        } as never),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'conflict', code: 'RESOURCE_CONFLICT' },
      });
    });
  });

  describe('updateAllergy', () => {
    it('updates allergy by id', async () => {
      prisma.userAllergy.update.mockResolvedValue(undefined as never);

      const result = await collectResult(
        repository.updateAllergy('allergy-1', { isActive: false } as never),
      );

      expect(result).toEqual({ ok: true, value: undefined });
      expect(prisma.userAllergy.update).toHaveBeenCalledWith({
        where: { id: 'allergy-1' },
        data: { isActive: false },
      });
    });

    it('maps a missing row to RESOURCE_NOT_FOUND', async () => {
      prisma.userAllergy.update.mockRejectedValue(prismaError('P2025'));

      const result = await collectResult(
        repository.updateAllergy('missing', { isActive: false } as never),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });
  });

  describe('softDeleteAllergy', () => {
    it('sets isActive to false', async () => {
      prisma.userAllergy.update.mockResolvedValue(undefined as never);

      const result = await collectResult(
        repository.softDeleteAllergy('allergy-1'),
      );

      expect(result).toEqual({ ok: true, value: undefined });
      expect(prisma.userAllergy.update).toHaveBeenCalledWith({
        where: { id: 'allergy-1' },
        data: { isActive: false },
      });
    });
  });

  describe('findAllergyById', () => {
    it('queries by id and selects userId', async () => {
      prisma.userAllergy.findFirst.mockResolvedValue({
        userId: 'user-1',
      } as never);

      const result = await repository.findAllergyById('allergy-1');

      expect(result).toMatchObject({ userId: 'user-1' });
      expect(prisma.userAllergy.findFirst).toHaveBeenCalledWith({
        where: { id: 'allergy-1' },
        select: { userId: true },
      });
    });
  });

  describe('createCondition', () => {
    it('creates condition with provided data', async () => {
      prisma.userCondition.create.mockResolvedValue(undefined as never);

      const result = await collectResult(
        repository.createCondition({ name: 'Hypertension' } as never),
      );

      expect(result).toEqual({ ok: true, value: undefined });
      expect(prisma.userCondition.create).toHaveBeenCalledWith({
        data: { name: 'Hypertension' },
      });
    });
  });

  describe('updateCondition', () => {
    it('updates condition by id', async () => {
      prisma.userCondition.update.mockResolvedValue(undefined as never);

      const result = await collectResult(
        repository.updateCondition('cond-1', { name: 'Updated' } as never),
      );

      expect(result).toEqual({ ok: true, value: undefined });
      expect(prisma.userCondition.update).toHaveBeenCalledWith({
        where: { id: 'cond-1' },
        data: { name: 'Updated' },
      });
    });
  });

  describe('softDeleteCondition', () => {
    it('sets status to resolved and sets resolvedAt', async () => {
      prisma.userCondition.update.mockResolvedValue(undefined as never);

      const resolvedAt = new Date('2026-07-10');
      const result = await collectResult(
        repository.softDeleteCondition('cond-1', resolvedAt),
      );

      expect(result).toEqual({ ok: true, value: undefined });
      expect(prisma.userCondition.update).toHaveBeenCalledWith({
        where: { id: 'cond-1' },
        data: { status: 'resolved', resolvedAt },
      });
    });
  });

  describe('findConditionById', () => {
    it('queries by id and selects userId', async () => {
      prisma.userCondition.findFirst.mockResolvedValue({
        userId: 'user-1',
      } as never);

      const result = await repository.findConditionById('cond-1');

      expect(result).toMatchObject({ userId: 'user-1' });
      expect(prisma.userCondition.findFirst).toHaveBeenCalledWith({
        where: { id: 'cond-1' },
        select: { userId: true },
      });
    });
  });

  describe('createCurrentMedicine', () => {
    it('creates current medicine with provided data', async () => {
      prisma.userCurrentMedicine.create.mockResolvedValue(undefined as never);

      const result = await collectResult(
        repository.createCurrentMedicine({
          userId: 'user-1',
          medicineId: 'med-1',
        } as never),
      );

      expect(result).toEqual({ ok: true, value: undefined });
      expect(prisma.userCurrentMedicine.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', medicineId: 'med-1' },
      });
    });
  });

  describe('updateCurrentMedicine', () => {
    it('updates current medicine by id', async () => {
      prisma.userCurrentMedicine.update.mockResolvedValue(undefined as never);

      const result = await collectResult(
        repository.updateCurrentMedicine('cm-1', { isCurrent: true } as never),
      );

      expect(result).toEqual({ ok: true, value: undefined });
      expect(prisma.userCurrentMedicine.update).toHaveBeenCalledWith({
        where: { id: 'cm-1' },
        data: { isCurrent: true },
      });
    });
  });

  describe('softDeleteCurrentMedicine', () => {
    it('sets isCurrent false and preserves existing endedAt when present', async () => {
      prisma.userCurrentMedicine.findUnique.mockResolvedValue({
        endedAt: new Date('2026-06-01'),
      } as never);
      prisma.userCurrentMedicine.update.mockResolvedValue(undefined as never);

      const endedAt = new Date('2026-07-10');
      const result = await collectResult(
        repository.softDeleteCurrentMedicine('cm-1', endedAt),
      );

      expect(result).toEqual({ ok: true, value: undefined });
      expect(prisma.userCurrentMedicine.update).toHaveBeenCalledWith({
        where: { id: 'cm-1' },
        data: { isCurrent: false, endedAt: new Date('2026-06-01') },
      });
    });

    it('uses provided endedAt when no existing value', async () => {
      prisma.userCurrentMedicine.findUnique.mockResolvedValue(null);
      prisma.userCurrentMedicine.update.mockResolvedValue(undefined as never);

      const endedAt = new Date('2026-07-10');
      const result = await collectResult(
        repository.softDeleteCurrentMedicine('cm-1', endedAt),
      );

      expect(result).toEqual({ ok: true, value: undefined });
      expect(prisma.userCurrentMedicine.update).toHaveBeenCalledWith({
        where: { id: 'cm-1' },
        data: { isCurrent: false, endedAt },
      });
    });
  });

  describe('findCurrentMedicineById', () => {
    it('queries by id and selects userId and endedAt', async () => {
      prisma.userCurrentMedicine.findFirst.mockResolvedValue({
        userId: 'user-1',
        endedAt: null,
      } as never);

      const result = await repository.findCurrentMedicineById('cm-1');

      expect(result).toMatchObject({ userId: 'user-1', endedAt: null });
      expect(prisma.userCurrentMedicine.findFirst).toHaveBeenCalledWith({
        where: { id: 'cm-1' },
        select: { userId: true, endedAt: true },
      });
    });
  });

  describe('findActiveUserById', () => {
    it('queries non-deleted user by id', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' } as never);

      const result = await repository.findActiveUserById('user-1');

      expect(result).toMatchObject({ id: 'user-1' });
      const call = prisma.user.findFirst.mock.calls[0]?.[0];
      expect(call?.where).toMatchObject({ id: 'user-1', deletedAt: null });
    });
  });
});
