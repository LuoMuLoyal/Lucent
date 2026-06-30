import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserHealthContextOwnershipService } from './ownership.service';

describe('UserHealthContextOwnershipService', () => {
  let service: UserHealthContextOwnershipService;
  let findFirst: jest.Mock;
  let findAllergy: jest.Mock;
  let findCondition: jest.Mock;
  let findMedicine: jest.Mock;
  let i18nT: jest.Mock;

  beforeEach(async () => {
    findFirst = jest.fn();
    findAllergy = jest.fn();
    findCondition = jest.fn();
    findMedicine = jest.fn();
    i18nT = jest.fn().mockReturnValue('Not found');

    const module = await Test.createTestingModule({
      providers: [
        UserHealthContextOwnershipService,
        {
          provide: PrismaService,
          useValue: {
            user: { findFirst },
            userAllergy: { findUnique: findAllergy },
            userCondition: { findUnique: findCondition },
            userCurrentMedicine: { findUnique: findMedicine },
          },
        },
        { provide: I18nService, useValue: { t: i18nT } },
      ],
    }).compile();

    service = module.get(UserHealthContextOwnershipService);
  });

  describe('ensureActiveUserExists', () => {
    it('resolves when an active user exists', async () => {
      findFirst.mockResolvedValue({ id: 'u1' });
      await expect(
        service.ensureActiveUserExists('u1'),
      ).resolves.toBeUndefined();
    });

    it('throws NotFoundException when user not found', async () => {
      findFirst.mockResolvedValue(null);
      await expect(service.ensureActiveUserExists('u1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('ensureAllergyOwnedByUser', () => {
    it('resolves when allergy belongs to user', async () => {
      findAllergy.mockResolvedValue({ userId: 'u1' });
      await expect(
        service.ensureAllergyOwnedByUser('u1', 'a1'),
      ).resolves.toBeUndefined();
    });

    it('throws when allergy belongs to different user', async () => {
      findAllergy.mockResolvedValue({ userId: 'u2' });
      await expect(
        service.ensureAllergyOwnedByUser('u1', 'a1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('ensureConditionOwnedByUser', () => {
    it('resolves when condition belongs to user', async () => {
      findCondition.mockResolvedValue({ userId: 'u1' });
      await expect(
        service.ensureConditionOwnedByUser('u1', 'c1'),
      ).resolves.toBeUndefined();
    });

    it('throws when condition belongs to different user', async () => {
      findCondition.mockResolvedValue({ userId: 'u2' });
      await expect(
        service.ensureConditionOwnedByUser('u1', 'c1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('ensureCurrentMedicineOwnedByUser', () => {
    it('resolves when medicine belongs to user', async () => {
      findMedicine.mockResolvedValue({ userId: 'u1' });
      await expect(
        service.ensureCurrentMedicineOwnedByUser('u1', 'm1'),
      ).resolves.toBeUndefined();
    });

    it('throws when medicine belongs to different user', async () => {
      findMedicine.mockResolvedValue({ userId: 'u2' });
      await expect(
        service.ensureCurrentMedicineOwnedByUser('u1', 'm1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
