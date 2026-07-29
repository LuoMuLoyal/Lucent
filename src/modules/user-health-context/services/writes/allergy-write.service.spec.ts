import { Test } from '@nestjs/testing';
import { type Mocked } from 'vitest';
import { UserHealthContextRepositoryPort } from '../../repositories/health-context.repository';
import { UserHealthContextOwnershipService } from '../ownership.service';
import { UserHealthContextAllergyWriteService } from './allergy-write.service';

describe('UserHealthContextAllergyWriteService', () => {
  let service: UserHealthContextAllergyWriteService;

  let repository: Mocked<UserHealthContextRepositoryPort>;
  let ensureActive: vi.Mock;
  let ensureOwned: vi.Mock;

  beforeEach(async () => {
    repository = {
      createAllergy: vi.fn(),
      updateAllergy: vi.fn(),
      softDeleteAllergy: vi.fn(),
    } as unknown as Mocked<UserHealthContextRepositoryPort>;
    ensureActive = vi.fn();
    ensureOwned = vi.fn();
    const module = await Test.createTestingModule({
      providers: [
        UserHealthContextAllergyWriteService,
        { provide: UserHealthContextRepositoryPort, useValue: repository },
        {
          provide: UserHealthContextOwnershipService,
          useValue: {
            ensureActiveUserExists: ensureActive,
            ensureAllergyOwnedByUser: ensureOwned,
          },
        },
      ],
    }).compile();
    service = module.get(UserHealthContextAllergyWriteService);
  });

  it('creates', async () => {
    await service.create('u1', {
      kind: 'drug',
      label: '青霉素',
      reaction: '皮疹',
      severity: 'moderate',
      note: null as any,
      recordedAt: '2025-06-01T00:00:00.000Z',
    });
    expect(ensureActive).toHaveBeenCalledWith('u1');
    expect(repository.createAllergy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', kind: 'drug' }),
    );
  });

  it('updates', async () => {
    await service.update('u1', 'a1', { label: '阿莫西林' });
    expect(ensureOwned).toHaveBeenCalledWith('u1', 'a1');
    expect(repository.updateAllergy).toHaveBeenCalledWith('a1', {
      label: '阿莫西林',
    });
  });

  it('soft-deletes', async () => {
    await service.softDelete('u1', 'a1');
    expect(ensureOwned).toHaveBeenCalledWith('u1', 'a1');
    expect(repository.softDeleteAllergy).toHaveBeenCalledWith('a1');
  });
});
