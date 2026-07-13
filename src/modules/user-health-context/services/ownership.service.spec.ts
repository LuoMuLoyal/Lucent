import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { type Mocked } from 'vitest';
import { UserHealthContextRepositoryPort } from '../repositories';
import { UserHealthContextOwnershipService } from './ownership.service';

describe('UserHealthContextOwnershipService', () => {
  let service: UserHealthContextOwnershipService;

  let repository: Mocked<UserHealthContextRepositoryPort>;
  let i18nT: vi.Mock;

  beforeEach(async () => {
    repository = {
      findActiveUserById: vi.fn(),
      findAllergyById: vi.fn(),
      findConditionById: vi.fn(),
      findCurrentMedicineById: vi.fn(),
    } as unknown as Mocked<UserHealthContextRepositoryPort>;
    i18nT = vi.fn().mockReturnValue('Not found');

    const module = await Test.createTestingModule({
      providers: [
        UserHealthContextOwnershipService,
        { provide: UserHealthContextRepositoryPort, useValue: repository },
        { provide: I18nService, useValue: { t: i18nT } },
      ],
    }).compile();

    service = module.get(UserHealthContextOwnershipService);
  });

  describe('ensureActiveUserExists', () => {
    it('resolves when an active user exists', async () => {
      repository.findActiveUserById.mockResolvedValue({ id: 'u1' });
      await expect(
        service.ensureActiveUserExists('u1'),
      ).resolves.toBeUndefined();
    });

    it('throws NotFoundException when user not found', async () => {
      repository.findActiveUserById.mockResolvedValue(null);
      await expect(service.ensureActiveUserExists('u1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('ensureAllergyOwnedByUser', () => {
    it('resolves when allergy belongs to user', async () => {
      repository.findAllergyById.mockResolvedValue({ userId: 'u1' });
      await expect(
        service.ensureAllergyOwnedByUser('u1', 'a1'),
      ).resolves.toBeUndefined();
    });

    it('throws when allergy belongs to different user', async () => {
      repository.findAllergyById.mockResolvedValue({ userId: 'u2' });
      await expect(
        service.ensureAllergyOwnedByUser('u1', 'a1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('ensureConditionOwnedByUser', () => {
    it('resolves when condition belongs to user', async () => {
      repository.findConditionById.mockResolvedValue({ userId: 'u1' });
      await expect(
        service.ensureConditionOwnedByUser('u1', 'c1'),
      ).resolves.toBeUndefined();
    });

    it('throws when condition belongs to different user', async () => {
      repository.findConditionById.mockResolvedValue({ userId: 'u2' });
      await expect(
        service.ensureConditionOwnedByUser('u1', 'c1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('ensureCurrentMedicineOwnedByUser', () => {
    it('resolves when medicine belongs to user', async () => {
      repository.findCurrentMedicineById.mockResolvedValue({
        userId: 'u1',
        endedAt: null,
      });
      await expect(
        service.ensureCurrentMedicineOwnedByUser('u1', 'm1'),
      ).resolves.toBeUndefined();
    });

    it('throws when medicine belongs to different user', async () => {
      repository.findCurrentMedicineById.mockResolvedValue({
        userId: 'u2',
        endedAt: null,
      });
      await expect(
        service.ensureCurrentMedicineOwnedByUser('u1', 'm1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when allergy record is null', async () => {
      repository.findAllergyById.mockResolvedValue(null);
      await expect(
        service.ensureAllergyOwnedByUser('u1', 'a1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when condition record is null', async () => {
      repository.findConditionById.mockResolvedValue(null);
      await expect(
        service.ensureConditionOwnedByUser('u1', 'c1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when current medicine record is null', async () => {
      repository.findCurrentMedicineById.mockResolvedValue(null);
      await expect(
        service.ensureCurrentMedicineOwnedByUser('u1', 'm1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
