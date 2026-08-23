import { Test } from '@nestjs/testing';
import { type Mocked } from 'vitest';
import { okAsync, errAsync } from '../../../../common/result';
import type { DomainFailure, ResultAsync } from '../../../../common/result';
import { UserHealthContextRepositoryPort } from '../../repositories/health-context.repository';
import { UserHealthContextOwnershipService } from '../ownership.service';
import { UserHealthContextAllergyWriteService } from './allergy-write.service';

async function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

describe('UserHealthContextAllergyWriteService', () => {
  let service: UserHealthContextAllergyWriteService;

  let repository: Mocked<UserHealthContextRepositoryPort>;
  let ensureActive: vi.Mock;
  let ensureOwned: vi.Mock;

  beforeEach(async () => {
    repository = {
      createAllergy: vi.fn().mockReturnValue(okAsync(undefined)),
      updateAllergy: vi.fn().mockReturnValue(okAsync(undefined)),
      softDeleteAllergy: vi.fn().mockReturnValue(okAsync(undefined)),
    } as unknown as Mocked<UserHealthContextRepositoryPort>;
    ensureActive = vi.fn().mockReturnValue(okAsync(undefined));
    ensureOwned = vi.fn().mockReturnValue(okAsync(undefined));
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
    await expect(
      collectResult(
        service.create('u1', {
          kind: 'drug',
          label: '青霉素',
          reaction: '皮疹',
          severity: 'moderate',
          note: null as any,
          recordedAt: '2025-06-01T00:00:00.000Z',
        }),
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(ensureActive).toHaveBeenCalledWith('u1');
    expect(repository.createAllergy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', kind: 'drug' }),
    );
  });

  it('propagates an active-user-not-found failure', async () => {
    ensureActive.mockReturnValue(
      errAsync({ kind: 'not_found', code: 'RESOURCE_NOT_FOUND' }),
    );

    await expect(
      collectResult(service.create('u1', { kind: 'drug', label: '青霉素' })),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
    });
    expect(repository.createAllergy).not.toHaveBeenCalled();
  });

  it('updates', async () => {
    await expect(
      collectResult(service.update('u1', 'a1', { label: '阿莫西林' })),
    ).resolves.toMatchObject({ ok: true });
    expect(ensureOwned).toHaveBeenCalledWith('u1', 'a1');
    expect(repository.updateAllergy).toHaveBeenCalledWith('a1', {
      label: '阿莫西林',
    });
  });

  it('propagates a foreign-allergy FORBIDDEN failure', async () => {
    ensureOwned.mockReturnValue(
      errAsync({ kind: 'authorization', code: 'FORBIDDEN' }),
    );

    await expect(
      collectResult(service.update('u1', 'a1', { label: '阿莫西林' })),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'authorization', code: 'FORBIDDEN' },
    });
    expect(repository.updateAllergy).not.toHaveBeenCalled();
  });

  it('soft-deletes', async () => {
    await expect(
      collectResult(service.softDelete('u1', 'a1')),
    ).resolves.toMatchObject({
      ok: true,
    });
    expect(ensureOwned).toHaveBeenCalledWith('u1', 'a1');
    expect(repository.softDeleteAllergy).toHaveBeenCalledWith('a1');
  });
});
