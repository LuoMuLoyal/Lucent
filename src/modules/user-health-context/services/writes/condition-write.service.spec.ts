import { Test } from '@nestjs/testing';
import { type Mocked } from 'vitest';
import { okAsync, errAsync } from '../../../../common/result';
import type { DomainFailure, ResultAsync } from '../../../../common/result';
import { UserHealthContextRepositoryPort } from '../../repositories/health-context.repository';
import { UserHealthContextOwnershipService } from '../ownership.service';
import { UserHealthContextMapperService } from '../mapper.service';
import { UserHealthContextConditionWriteService } from './condition-write.service';

async function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

describe('UserHealthContextConditionWriteService', () => {
  let service: UserHealthContextConditionWriteService;

  let repository: Mocked<UserHealthContextRepositoryPort>;
  let ensureActive: vi.Mock;
  let ensureOwned: vi.Mock;

  beforeEach(async () => {
    repository = {
      createCondition: vi.fn().mockReturnValue(okAsync(undefined)),
      updateCondition: vi.fn().mockReturnValue(okAsync(undefined)),
      softDeleteCondition: vi.fn().mockReturnValue(okAsync(undefined)),
      findConditionById: vi.fn(),
    } as unknown as Mocked<UserHealthContextRepositoryPort>;
    ensureActive = vi.fn().mockReturnValue(okAsync(undefined));
    ensureOwned = vi.fn().mockReturnValue(okAsync(undefined));
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
    await expect(
      collectResult(
        service.create('u1', {
          label: '高血压',
          status: 'active',
          diagnosedAt: '2024-01-01',
          note: null as any,
        }),
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(ensureActive).toHaveBeenCalledWith('u1');
    expect(repository.createCondition).toHaveBeenCalledWith(
      expect.objectContaining({ user: { connect: { id: 'u1' } } }),
    );
  });

  it('propagates an active-user-not-found failure', async () => {
    ensureActive.mockReturnValue(
      errAsync({ kind: 'not_found', code: 'RESOURCE_NOT_FOUND' }),
    );

    await expect(
      collectResult(service.create('u1', { label: '高血压' })),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
    });
    expect(repository.createCondition).not.toHaveBeenCalled();
  });

  it('updates', async () => {
    await expect(
      collectResult(service.update('u1', 'c1', { label: '高血糖' })),
    ).resolves.toMatchObject({ ok: true });
    expect(ensureOwned).toHaveBeenCalledWith('u1', 'c1');
    expect(repository.updateCondition).toHaveBeenCalledWith('c1', {
      label: '高血糖',
    });
  });

  it('propagates a foreign-condition FORBIDDEN failure', async () => {
    ensureOwned.mockReturnValue(
      errAsync({ kind: 'authorization', code: 'FORBIDDEN' }),
    );

    await expect(
      collectResult(service.update('u1', 'c1', { label: '高血糖' })),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'authorization', code: 'FORBIDDEN' },
    });
    expect(repository.updateCondition).not.toHaveBeenCalled();
  });

  it('soft-deletes', async () => {
    await expect(
      collectResult(service.softDelete('u1', 'c1')),
    ).resolves.toMatchObject({
      ok: true,
    });
    expect(repository.softDeleteCondition).toHaveBeenCalledWith(
      'c1',
      expect.any(Date),
    );
  });
});
