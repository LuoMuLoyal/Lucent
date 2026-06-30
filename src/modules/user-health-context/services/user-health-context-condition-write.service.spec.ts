import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserHealthContextOwnershipService } from './ownership.service';
import { UserHealthContextMapperService } from './user-health-context-mapper.service';
import { UserHealthContextConditionWriteService } from './user-health-context-condition-write.service';

describe('UserHealthContextConditionWriteService', () => {
  let service: UserHealthContextConditionWriteService;
  let createCond: jest.Mock;
  let updateCond: jest.Mock;
  let findUniqueCond: jest.Mock;
  let ensureActive: jest.Mock;
  let ensureOwned: jest.Mock;

  beforeEach(async () => {
    createCond = jest.fn();
    updateCond = jest.fn();
    findUniqueCond = jest.fn();
    ensureActive = jest.fn();
    ensureOwned = jest.fn();
    const module = await Test.createTestingModule({
      providers: [
        UserHealthContextConditionWriteService,
        {
          provide: PrismaService,
          useValue: {
            userCondition: {
              create: createCond,
              update: updateCond,
              findUnique: findUniqueCond,
            },
          },
        },
        {
          provide: UserHealthContextOwnershipService,
          useValue: {
            ensureActiveUserExists: ensureActive,
            ensureConditionOwnedByUser: ensureOwned,
          },
        },
        {
          provide: UserHealthContextMapperService,
          useValue: {
            dateOnlyStringToUtcDate: jest.fn((v: any) =>
              v ? new Date(v) : null,
            ),
            toUtcDateOnly: jest.fn(() => new Date('2026-06-15T00:00:00Z')),
          },
        },
      ],
    }).compile();
    service = module.get(UserHealthContextConditionWriteService);
  });

  it('creates', async () => {
    await service.create('u1', {
      label: '高血压',
      status: 'active',
      diagnosedAt: '2024-01-01',
      note: null as any,
    });
    expect(ensureActive).toHaveBeenCalledWith('u1');
    expect(createCond).toHaveBeenCalledWith({
      data: expect.objectContaining({ user: { connect: { id: 'u1' } } }),
    });
  });

  it('updates', async () => {
    await service.update('u1', 'c1', { label: '高血糖' });
    expect(ensureOwned).toHaveBeenCalledWith('u1', 'c1');
    expect(updateCond).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { label: '高血糖' },
    });
  });

  it('soft-deletes', async () => {
    findUniqueCond.mockResolvedValue({ resolvedAt: null });
    await service.softDelete('u1', 'c1');
    expect(updateCond).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({ status: 'resolved' }),
    });
  });
});
