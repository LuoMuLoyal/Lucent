import { Test } from '@nestjs/testing';
import type { DomainFailure, ResultAsync } from '../../../common/result';
import { DailyRecordRepositoryPort } from '../repositories/daily-record.repository';
import { DailyRecordsOwnershipService } from './ownership.service';

async function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

describe('DailyRecordsOwnershipService', () => {
  let service: DailyRecordsOwnershipService;
  let findOwnershipData: vi.Mock;

  beforeEach(async () => {
    findOwnershipData = vi.fn();

    const module = await Test.createTestingModule({
      providers: [
        DailyRecordsOwnershipService,
        {
          provide: DailyRecordRepositoryPort,
          useValue: { findOwnershipData },
        },
      ],
    }).compile();

    service = module.get(DailyRecordsOwnershipService);
  });

  describe('ensureOwnedByUser', () => {
    it('returns snapshot when record belongs to user', async () => {
      findOwnershipData.mockResolvedValue({
        userId: 'u1',
        kind: 'note',
        payload: { key: 'val' },
        occurredAt: new Date('2026-07-10'),
      });

      const result = await collectResult(service.ensureOwnedByUser('u1', 'r1'));

      expect(result).toMatchObject({ ok: true });
      expect(findOwnershipData).toHaveBeenCalledWith('r1');
    });

    it('returns RESOURCE_NOT_FOUND when record not found', async () => {
      findOwnershipData.mockResolvedValue(null);
      await expect(
        collectResult(service.ensureOwnedByUser('u1', 'r1')),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });

    it('returns FORBIDDEN when record belongs to different user', async () => {
      findOwnershipData.mockResolvedValue({
        userId: 'u2',
        kind: 'note',
        payload: null,
      });
      await expect(
        collectResult(service.ensureOwnedByUser('u1', 'r1')),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'authorization', code: 'FORBIDDEN' },
      });
    });

    it('rethrows an unknown database error instead of wrapping it as a domain failure', async () => {
      findOwnershipData.mockRejectedValue(new Error('connection lost'));

      await expect(service.ensureOwnedByUser('u1', 'r1')).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('throwRecordNotFound', () => {
    it('throws an invariant error for transaction read-back violations', () => {
      expect(() => service.throwRecordNotFound()).toThrow(/invariant/);
    });
  });
});
