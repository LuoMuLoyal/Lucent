import { Test } from '@nestjs/testing';
import { MedicineSource } from '#generated/prisma/client.js';
import { type Mocked } from 'vitest';
import { okAsync, errAsync } from '../../../../common/result/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import { UserHealthContextRepositoryPort } from '../ports/health-context-repository.js';
import { UserHealthContextOwnership } from '../../application/use_cases/ownership.js';
import { UserHealthContextMapper } from '../read_models/mapper.js';
import { MedicineUseCases } from './medicines.js';

async function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

describe('MedicineUseCases', () => {
  let service: MedicineUseCases;

  let repository: Mocked<UserHealthContextRepositoryPort>;
  let ensureActive: vi.Mock;
  let ensureOwned: vi.Mock;

  beforeEach(async () => {
    repository = {
      createCurrentMedicine: vi.fn().mockReturnValue(okAsync(undefined)),
      updateCurrentMedicine: vi.fn().mockReturnValue(okAsync(undefined)),
      softDeleteCurrentMedicine: vi.fn().mockReturnValue(okAsync(undefined)),
      findCurrentMedicineById: vi.fn(),
    } as unknown as Mocked<UserHealthContextRepositoryPort>;
    ensureActive = vi.fn().mockReturnValue(okAsync(undefined));
    ensureOwned = vi.fn().mockReturnValue(okAsync(undefined));
    const module = await Test.createTestingModule({
      providers: [
        MedicineUseCases,
        { provide: UserHealthContextRepositoryPort, useValue: repository },
        {
          provide: UserHealthContextOwnership,
          useValue: {
            ensureActiveUserExists: ensureActive,
            ensureCurrentMedicineOwnedByUser: ensureOwned,
          },
        },
        {
          provide: UserHealthContextMapper,
          useValue: {
            dateOnlyStringToUtcDate: vi.fn((v: any) =>
              v ? new Date(v) : null,
            ),
            toUtcDateOnly: vi.fn(() => new Date('2026-06-15T00:00:00Z')),
          },
        },
      ],
    }).compile();
    service = module.get(MedicineUseCases);
  });

  it('creates manual medicine forces sourceRefId null', async () => {
    await expect(
      collectResult(
        service.create('u1', {
          source: MedicineSource.manual,
          sourceRefId: 'ext-1',
          displayName: '阿莫西林',
        }),
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(repository.createCurrentMedicine).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRefId: null }),
    );
  });

  it('keeps sourceRefId for non-manual', async () => {
    await expect(
      collectResult(
        service.create('u1', {
          source: MedicineSource.cn,
          sourceRefId: 'ext-1',
          displayName: '阿莫西林',
        }),
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(repository.createCurrentMedicine).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRefId: 'ext-1' }),
    );
  });

  it('propagates an active-user-not-found failure', async () => {
    ensureActive.mockReturnValue(
      errAsync({ kind: 'not_found', code: 'RESOURCE_NOT_FOUND' }),
    );

    await expect(
      collectResult(
        service.create('u1', {
          source: MedicineSource.manual,
          displayName: '阿莫西林',
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
    });
    expect(repository.createCurrentMedicine).not.toHaveBeenCalled();
  });

  it('updates', async () => {
    await expect(
      collectResult(service.update('u1', 'm1', { displayName: '头孢拉定' })),
    ).resolves.toMatchObject({ ok: true });
    expect(ensureOwned).toHaveBeenCalledWith('u1', 'm1');
    expect(repository.updateCurrentMedicine).toHaveBeenCalledWith('m1', {
      displayName: '头孢拉定',
    });
  });

  it('propagates a foreign-medicine FORBIDDEN failure', async () => {
    ensureOwned.mockReturnValue(
      errAsync({ kind: 'authorization', code: 'FORBIDDEN' }),
    );

    await expect(
      collectResult(service.update('u1', 'm1', { displayName: '头孢拉定' })),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'authorization', code: 'FORBIDDEN' },
    });
    expect(repository.updateCurrentMedicine).not.toHaveBeenCalled();
  });

  it('soft-deletes', async () => {
    await expect(
      collectResult(service.softDelete('u1', 'm1')),
    ).resolves.toMatchObject({
      ok: true,
    });
    expect(repository.softDeleteCurrentMedicine).toHaveBeenCalledWith(
      'm1',
      expect.any(Date),
    );
  });
});
