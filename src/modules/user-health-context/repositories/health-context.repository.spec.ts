/* eslint-disable @typescript-eslint/no-unsafe-call */
import { UserHealthContextRepository } from './health-context.repository';
import type { PrismaService } from '../../../prisma/prisma.service';

describe('UserHealthContextRepository', () => {
  let repository: UserHealthContextRepository;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      user: { findFirst: jest.fn() },
      userProfile: { findUnique: jest.fn(), upsert: jest.fn() },
      userAllergy: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      userCondition: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      userCurrentMedicine: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

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

      await repository.upsertProfile(
        { userId: 'user-1' },
        { userId: 'user-1', heightCm: 170 } as never,
        { heightCm: 175 } as never,
      );

      expect(prisma.userProfile.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: { userId: 'user-1', heightCm: 170 },
        update: { heightCm: 175 },
      });
    });
  });

  describe('createAllergy', () => {
    it('creates allergy with provided data', async () => {
      prisma.userAllergy.create.mockResolvedValue(undefined as never);

      await repository.createAllergy({
        userId: 'user-1',
        allergen: 'pollen',
      } as never);

      expect(prisma.userAllergy.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', allergen: 'pollen' },
      });
    });
  });

  describe('updateAllergy', () => {
    it('updates allergy by id', async () => {
      prisma.userAllergy.update.mockResolvedValue(undefined as never);

      await repository.updateAllergy('allergy-1', { isActive: false } as never);

      expect(prisma.userAllergy.update).toHaveBeenCalledWith({
        where: { id: 'allergy-1' },
        data: { isActive: false },
      });
    });
  });

  describe('softDeleteAllergy', () => {
    it('sets isActive to false', async () => {
      prisma.userAllergy.update.mockResolvedValue(undefined as never);

      await repository.softDeleteAllergy('allergy-1');

      expect(prisma.userAllergy.update).toHaveBeenCalledWith({
        where: { id: 'allergy-1' },
        data: { isActive: false },
      });
    });
  });

  describe('findAllergyById', () => {
    it('queries by id and selects userId', async () => {
      prisma.userAllergy.findUnique.mockResolvedValue({
        userId: 'user-1',
      } as never);

      const result = await repository.findAllergyById('allergy-1');

      expect(result).toMatchObject({ userId: 'user-1' });
      expect(prisma.userAllergy.findUnique).toHaveBeenCalledWith({
        where: { id: 'allergy-1' },
        select: { userId: true },
      });
    });
  });

  describe('createCondition', () => {
    it('creates condition with provided data', async () => {
      prisma.userCondition.create.mockResolvedValue(undefined as never);

      await repository.createCondition({ name: 'Hypertension' } as never);

      expect(prisma.userCondition.create).toHaveBeenCalledWith({
        data: { name: 'Hypertension' },
      });
    });
  });

  describe('updateCondition', () => {
    it('updates condition by id', async () => {
      prisma.userCondition.update.mockResolvedValue(undefined as never);

      await repository.updateCondition('cond-1', { name: 'Updated' } as never);

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
      await repository.softDeleteCondition('cond-1', resolvedAt);

      expect(prisma.userCondition.update).toHaveBeenCalledWith({
        where: { id: 'cond-1' },
        data: { status: 'resolved', resolvedAt },
      });
    });
  });

  describe('findConditionById', () => {
    it('queries by id and selects userId', async () => {
      prisma.userCondition.findUnique.mockResolvedValue({
        userId: 'user-1',
      } as never);

      const result = await repository.findConditionById('cond-1');

      expect(result).toMatchObject({ userId: 'user-1' });
      expect(prisma.userCondition.findUnique).toHaveBeenCalledWith({
        where: { id: 'cond-1' },
        select: { userId: true },
      });
    });
  });

  describe('createCurrentMedicine', () => {
    it('creates current medicine with provided data', async () => {
      prisma.userCurrentMedicine.create.mockResolvedValue(undefined as never);

      await repository.createCurrentMedicine({
        userId: 'user-1',
        medicineId: 'med-1',
      } as never);

      expect(prisma.userCurrentMedicine.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', medicineId: 'med-1' },
      });
    });
  });

  describe('updateCurrentMedicine', () => {
    it('updates current medicine by id', async () => {
      prisma.userCurrentMedicine.update.mockResolvedValue(undefined as never);

      await repository.updateCurrentMedicine('cm-1', {
        isCurrent: true,
      } as never);

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
      await repository.softDeleteCurrentMedicine('cm-1', endedAt);

      expect(prisma.userCurrentMedicine.update).toHaveBeenCalledWith({
        where: { id: 'cm-1' },
        data: { isCurrent: false, endedAt: new Date('2026-06-01') },
      });
    });

    it('uses provided endedAt when no existing value', async () => {
      prisma.userCurrentMedicine.findUnique.mockResolvedValue(null);
      prisma.userCurrentMedicine.update.mockResolvedValue(undefined as never);

      const endedAt = new Date('2026-07-10');
      await repository.softDeleteCurrentMedicine('cm-1', endedAt);

      expect(prisma.userCurrentMedicine.update).toHaveBeenCalledWith({
        where: { id: 'cm-1' },
        data: { isCurrent: false, endedAt },
      });
    });
  });

  describe('findCurrentMedicineById', () => {
    it('queries by id and selects userId and endedAt', async () => {
      prisma.userCurrentMedicine.findUnique.mockResolvedValue({
        userId: 'user-1',
        endedAt: null,
      } as never);

      const result = await repository.findCurrentMedicineById('cm-1');

      expect(result).toMatchObject({ userId: 'user-1', endedAt: null });
      expect(prisma.userCurrentMedicine.findUnique).toHaveBeenCalledWith({
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
