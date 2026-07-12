import { Test } from '@nestjs/testing';
import { UserHealthContextRepositoryPort } from '../repositories';
import { UserHealthContextOwnershipService } from './ownership.service';
import { UserHealthContextMapperService } from './mapper.service';
import { UserHealthContextConditionWriteService } from './condition-write.service';

describe('UserHealthContextConditionWriteService', () => {
  let service: UserHealthContextConditionWriteService;

  let repository: any;
  let ensureActive: vi.Mock;
  let ensureOwned: vi.Mock;

  beforeEach(async () => {
    repository = {
      createCondition: vi.fn(),
      updateCondition: vi.fn(),
      softDeleteCondition: vi.fn(),
      findConditionById: vi.fn(),
    };
    ensureActive = vi.fn();
    ensureOwned = vi.fn();
    const module = await Test.createTestingModule({
      providers: [
        UserHealthContextConditionWriteService,
        { provide: UserHealthContextRepositoryPort, useValue: repository },
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
            dateOnlyStringToUtcDate: vi.fn((v: any) =>
              v ? new Date(v) : null,
            ),
            toUtcDateOnly: vi.fn(() => new Date('2026-06-15T00:00:00Z')),
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
    expect(repository.createCondition).toHaveBeenCalledWith(
      expect.objectContaining({ user: { connect: { id: 'u1' } } }),
    );
  });

  it('updates', async () => {
    await service.update('u1', 'c1', { label: '高血糖' });
    expect(ensureOwned).toHaveBeenCalledWith('u1', 'c1');
    expect(repository.updateCondition).toHaveBeenCalledWith('c1', {
      label: '高血糖',
    });
  });

  it('soft-deletes', async () => {
    await service.softDelete('u1', 'c1');
    expect(repository.softDeleteCondition).toHaveBeenCalledWith(
      'c1',
      expect.any(Date),
    );
  });
});
