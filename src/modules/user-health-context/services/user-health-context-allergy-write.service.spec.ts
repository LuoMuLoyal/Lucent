/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserHealthContextOwnershipService } from './ownership.service';
import { UserHealthContextAllergyWriteService } from './user-health-context-allergy-write.service';
import type { CreateHealthContextAllergyDto } from '../dto';

describe('UserHealthContextAllergyWriteService', () => {
  let service: UserHealthContextAllergyWriteService;
  let createAllergy: jest.Mock;
  let updateAllergy: jest.Mock;
  let ensureActiveUserExists: jest.Mock;
  let ensureAllergyOwnedByUser: jest.Mock;

  beforeEach(async () => {
    createAllergy = jest.fn();
    updateAllergy = jest.fn();
    ensureActiveUserExists = jest.fn();
    ensureAllergyOwnedByUser = jest.fn();

    const module = await Test.createTestingModule({
      providers: [
        UserHealthContextAllergyWriteService,
        {
          provide: PrismaService,
          useValue: {
            userAllergy: { create: createAllergy, update: updateAllergy },
          },
        },
        {
          provide: UserHealthContextOwnershipService,
          useValue: { ensureActiveUserExists, ensureAllergyOwnedByUser },
        },
      ],
    }).compile();

    service = module.get(UserHealthContextAllergyWriteService);
  });

  const createDto: CreateHealthContextAllergyDto = {
    kind: 'drug',
    label: '青霉素',
    reaction: '皮疹',
    severity: 'moderate',
    note: null,
    recordedAt: '2025-06-01T00:00:00.000Z',
  };

  describe('create', () => {
    it('invokes ensureActiveUserExists and creates record with full fields', async () => {
      await service.create('u1', createDto);

      expect(ensureActiveUserExists).toHaveBeenCalledWith('u1');
      expect(createAllergy).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          kind: 'drug',
          label: '青霉素',
        }),
      });
    });

    it('sends null for optional fields when omitted', async () => {
      await service.create('u1', {
        kind: 'food',
        label: '花生',
        reaction: null,
        severity: null,
        note: null,
        recordedAt: null,
      });

      expect(createAllergy).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reaction: null,
          severity: null,
          note: null,
          recordedAt: null,
        }),
      });
    });
  });

  describe('update', () => {
    it('verifies ownership then updates with provided fields', async () => {
      await service.update('u1', 'a1', {
        label: '阿莫西林',
      });

      expect(ensureAllergyOwnedByUser).toHaveBeenCalledWith('u1', 'a1');
      expect(updateAllergy).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { label: '阿莫西林' },
      });
    });
  });

  describe('softDelete', () => {
    it('verifies ownership then sets isActive to false', async () => {
      await service.softDelete('u1', 'a1');

      expect(ensureAllergyOwnedByUser).toHaveBeenCalledWith('u1', 'a1');
      expect(updateAllergy).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { isActive: false },
      });
    });
  });
});
