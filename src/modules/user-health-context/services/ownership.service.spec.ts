import { Test } from '@nestjs/testing';
import { type Mocked } from 'vitest';
import type { DomainFailure, ResultAsync } from '../../../common/result';
import { UserHealthContextRepositoryPort } from '../repositories/health-context.repository';
import { UserHealthContextOwnershipService } from './ownership.service';

async function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

describe('UserHealthContextOwnershipService', () => {
  let service: UserHealthContextOwnershipService;

  let repository: Mocked<UserHealthContextRepositoryPort>;

  beforeEach(async () => {
    repository = {
      findActiveUserById: vi.fn(),
      findAllergyById: vi.fn(),
      findConditionById: vi.fn(),
      findCurrentMedicineById: vi.fn(),
    } as unknown as Mocked<UserHealthContextRepositoryPort>;

    const module = await Test.createTestingModule({
      providers: [
        UserHealthContextOwnershipService,
        { provide: UserHealthContextRepositoryPort, useValue: repository },
      ],
    }).compile();

    service = module.get(UserHealthContextOwnershipService);
  });

  describe('ensureActiveUserExists', () => {
    it('resolves when an active user exists', async () => {
      repository.findActiveUserById.mockResolvedValue({ id: 'u1' });
      await expect(
        collectResult(service.ensureActiveUserExists('u1')),
      ).resolves.toMatchObject({ ok: true });
    });

    it('returns RESOURCE_NOT_FOUND when user not found', async () => {
      repository.findActiveUserById.mockResolvedValue(null);
      await expect(
        collectResult(service.ensureActiveUserExists('u1')),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });
  });

  describe('ensureAllergyOwnedByUser', () => {
    it('resolves when allergy belongs to user', async () => {
      repository.findAllergyById.mockResolvedValue({ userId: 'u1' });
      await expect(
        collectResult(service.ensureAllergyOwnedByUser('u1', 'a1')),
      ).resolves.toMatchObject({ ok: true });
    });

    it('returns FORBIDDEN when allergy belongs to different user', async () => {
      repository.findAllergyById.mockResolvedValue({ userId: 'u2' });
      await expect(
        collectResult(service.ensureAllergyOwnedByUser('u1', 'a1')),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'authorization', code: 'FORBIDDEN' },
      });
    });

    it('returns RESOURCE_NOT_FOUND when allergy does not exist', async () => {
      repository.findAllergyById.mockResolvedValue(null);
      await expect(
        collectResult(service.ensureAllergyOwnedByUser('u1', 'a1')),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });

    it('rethrows an unknown database error instead of wrapping it as a domain failure', async () => {
      repository.findAllergyById.mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(
        service.ensureAllergyOwnedByUser('u1', 'a1'),
      ).rejects.toThrow('connection lost');
    });
  });

  describe('ensureConditionOwnedByUser', () => {
    it('resolves when condition belongs to user', async () => {
      repository.findConditionById.mockResolvedValue({ userId: 'u1' });
      await expect(
        collectResult(service.ensureConditionOwnedByUser('u1', 'c1')),
      ).resolves.toMatchObject({ ok: true });
    });

    it('returns FORBIDDEN when condition belongs to different user', async () => {
      repository.findConditionById.mockResolvedValue({ userId: 'u2' });
      await expect(
        collectResult(service.ensureConditionOwnedByUser('u1', 'c1')),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'authorization', code: 'FORBIDDEN' },
      });
    });

    it('returns RESOURCE_NOT_FOUND when condition does not exist', async () => {
      repository.findConditionById.mockResolvedValue(null);
      await expect(
        collectResult(service.ensureConditionOwnedByUser('u1', 'c1')),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });
  });

  describe('ensureCurrentMedicineOwnedByUser', () => {
    it('resolves when medicine belongs to user', async () => {
      repository.findCurrentMedicineById.mockResolvedValue({
        userId: 'u1',
        endedAt: null,
      });
      await expect(
        collectResult(service.ensureCurrentMedicineOwnedByUser('u1', 'm1')),
      ).resolves.toMatchObject({ ok: true });
    });

    it('returns FORBIDDEN when medicine belongs to different user', async () => {
      repository.findCurrentMedicineById.mockResolvedValue({
        userId: 'u2',
        endedAt: null,
      });
      await expect(
        collectResult(service.ensureCurrentMedicineOwnedByUser('u1', 'm1')),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'authorization', code: 'FORBIDDEN' },
      });
    });

    it('returns RESOURCE_NOT_FOUND when medicine does not exist', async () => {
      repository.findCurrentMedicineById.mockResolvedValue(null);
      await expect(
        collectResult(service.ensureCurrentMedicineOwnedByUser('u1', 'm1')),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });
  });
});
