/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserHealthContextOwnershipService } from './ownership.service';
import { UserHealthContextMapperService } from './user-health-context-mapper.service';
import { UserHealthContextConditionWriteService } from './user-health-context-condition-write.service';
import type { CreateHealthContextConditionDto } from '../dto';

describe('UserHealthContextConditionWriteService', () => {
  let service: UserHealthContextConditionWriteService;
  let createCondition: jest.Mock;
  let updateCondition: jest.Mock;
  let findUniqueCondition: jest.Mock;
  let ensureActiveUserExists: jest.Mock;
  let ensureConditionOwned: jest.Mock;
  let dateOnlyStringToUtcDate: jest.Mock;
  let toUtcDateOnly: jest.Mock;

  beforeEach(async () => {
    createCondition = jest.fn();
    updateCondition = jest.fn();
    findUniqueCondition = jest.fn();
    ensureActiveUserExists = jest.fn();
    ensureConditionOwned = jest.fn();
    dateOnlyStringToUtcDate = jest.fn((v: string | null) =>
      v ? new Date(v) : null,
    );
    toUtcDateOnly = jest.fn(() => new Date('2026-06-15T00:00:00Z'));

    const module = await Test.createTestingModule({
      providers: [
        UserHealthContextConditionWriteService,
        {
          provide: PrismaService,
          useValue: {
            userCondition: {
              create: createCondition,
              update: updateCondition,
              findUnique: findUniqueCondition,
            },
          },
        },
        {
          provide: UserHealthContextOwnershipService,
          useValue: {
            ensureActiveUserExists,
            ensureConditionOwnedByUser: ensureConditionOwned,
          },
        },
        {
          provide: UserHealthContextMapperService,
          useValue: { dateOnlyStringToUtcDate, toUtcDateOnly },
        },
      ],
    }).compile();

    service = module.get(UserHealthContextConditionWriteService);
  });

  const createDto: CreateHealthContextConditionDto = {
    label: '高血压',
    status: 'active',
    diagnosedAt: '2024-01-01',
    note: null,
  };

  describe('create', () => {
    it('uses relation connect syntax for the user', async () => {
      await service.create('u1', createDto);

      expect(ensureActiveUserExists).toHaveBeenCalledWith('u1');
      expect(createCondition).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user: { connect: { id: 'u1' } },
          label: '高血压',
          status: 'active',
        }),
      });
    });

    it('omits status when undefined in dto', async () => {
      await service.create('u1', { label: '偏头痛' });
      expect(createCondition).toHaveBeenCalledWith({
        data: expect.not.objectContaining({
          status: expect.anything() as unknown,
        }),
      });
    });
  });

  describe('update', () => {
    it('verifies ownership then updates with provided label', async () => {
      await service.update('u1', 'c1', {
        label: '高血糖',
      });

      expect(ensureConditionOwned).toHaveBeenCalledWith('u1', 'c1');
      expect(updateCondition).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { label: '高血糖' },
      });
    });
  });

  describe('softDelete', () => {
    it('preserves existing resolvedAt when already set', async () => {
      const existingDate = new Date('2025-01-01');
      findUniqueCondition.mockResolvedValue({ resolvedAt: existingDate });

      await service.softDelete('u1', 'c1');

      expect(updateCondition).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'resolved', resolvedAt: existingDate },
      });
    });

    it('sets resolvedAt to current date when not previously resolved', async () => {
      findUniqueCondition.mockResolvedValue({ resolvedAt: null });

      await service.softDelete('u1', 'c1');

      expect(updateCondition).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: expect.objectContaining({ status: 'resolved' }),
      });
    });
  });
});
