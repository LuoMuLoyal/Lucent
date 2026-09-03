import { parseDateOnly } from '../../../../common/index.js';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { type Mocked } from 'vitest';
import { okAsync, errAsync } from '../../../../common/result/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import { UserHealthContextProfileWriteService } from './profile-write.service.js';
import { UserHealthContextRepositoryPort } from '../../repositories/health-context.repository.js';
import { UserHealthContextOwnershipService } from '../ownership.service.js';
import { UserHealthContextMapperService } from '../mapper.service.js';

async function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

describe('UserHealthContextProfileWriteService', () => {
  let service: UserHealthContextProfileWriteService;

  let repository: Mocked<UserHealthContextRepositoryPort>;
  let ensureActive: vi.Mock;

  beforeEach(async () => {
    repository = {
      findProfileByUserId: vi.fn().mockResolvedValue(null),
      upsertProfile: vi.fn().mockReturnValue(okAsync(undefined)),
    } as unknown as Mocked<UserHealthContextRepositoryPort>;
    ensureActive = vi.fn().mockReturnValue(okAsync(undefined));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserHealthContextProfileWriteService,
        { provide: UserHealthContextRepositoryPort, useValue: repository },
        {
          provide: UserHealthContextOwnershipService,
          useValue: {
            ensureActiveUserExists: ensureActive,
          },
        },
        {
          provide: UserHealthContextMapperService,
          useValue: {
            dateOnlyStringToUtcDate: vi
              .fn()
              .mockImplementation((v: string | null) =>
                v ? parseDateOnly(v) : null,
              ),
          },
        },
      ],
    }).compile();

    service = module.get(UserHealthContextProfileWriteService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('upsertProfile', () => {
    it('should upsert a locale field', async () => {
      await expect(
        collectResult(service.upsertProfile('user-1', { locale: 'zh-CN' })),
      ).resolves.toMatchObject({ ok: true });

      expect(repository.upsertProfile).toHaveBeenCalledWith(
        { userId: 'user-1' },
        expect.objectContaining({ locale: 'zh-CN' }),
        expect.objectContaining({ locale: 'zh-CN' }),
      );
    });

    it('should upsert heightCm', async () => {
      await expect(
        collectResult(service.upsertProfile('user-1', { heightCm: 170 })),
      ).resolves.toMatchObject({ ok: true });

      expect(repository.upsertProfile).toHaveBeenCalledWith(
        { userId: 'user-1' },
        expect.objectContaining({ heightCm: 170 }),
        expect.objectContaining({ heightCm: 170 }),
      );
    });

    it('should set onboardingCompletedAt when not yet set', async () => {
      repository.findProfileByUserId.mockResolvedValueOnce({
        onboardingCompletedAt: null,
      });

      await expect(
        collectResult(
          service.upsertProfile('user-1', { onboardingCompleted: true }),
        ),
      ).resolves.toMatchObject({ ok: true });

      expect(repository.upsertProfile).toHaveBeenCalledWith(
        { userId: 'user-1' },
        expect.objectContaining({
          onboardingCompletedAt: expect.any(Date),
        }),
        expect.objectContaining({
          onboardingCompletedAt: expect.any(Date),
        }),
      );
    });

    it('should not overwrite onboardingCompletedAt when already set', async () => {
      const existingDate = new Date('2026-01-01T00:00:00Z');
      repository.findProfileByUserId.mockResolvedValueOnce({
        onboardingCompletedAt: existingDate,
      });

      await expect(
        collectResult(
          service.upsertProfile('user-1', { onboardingCompleted: true }),
        ),
      ).resolves.toMatchObject({ ok: true });

      expect(repository.upsertProfile).not.toHaveBeenCalled();
    });

    it('should clear onboardingCompletedAt when false', async () => {
      await expect(
        collectResult(
          service.upsertProfile('user-1', { onboardingCompleted: false }),
        ),
      ).resolves.toMatchObject({ ok: true });

      expect(repository.upsertProfile).toHaveBeenCalledWith(
        { userId: 'user-1' },
        { userId: 'user-1' },
        { onboardingCompletedAt: null },
      );
    });

    it('should skip upsert when no fields changed', async () => {
      await expect(
        collectResult(service.upsertProfile('user-1', {})),
      ).resolves.toMatchObject({ ok: true });

      expect(repository.upsertProfile).not.toHaveBeenCalled();
    });

    it('should merge weightKg into extras', async () => {
      repository.findProfileByUserId.mockResolvedValueOnce({
        extras: { existingField: true },
      });

      await expect(
        collectResult(service.upsertProfile('user-1', { weightKg: 65 })),
      ).resolves.toMatchObject({ ok: true });

      expect(repository.upsertProfile).toHaveBeenCalledWith(
        { userId: 'user-1' },
        expect.objectContaining({
          extras: { existingField: true, weightKg: 65 },
        }),
        expect.objectContaining({
          extras: { existingField: true, weightKg: 65 },
        }),
      );
    });

    it('should clear weightKg from extras when null', async () => {
      repository.findProfileByUserId.mockResolvedValueOnce({
        extras: { weightKg: 65, other: 'keep' },
      });

      await expect(
        collectResult(service.upsertProfile('user-1', { weightKg: null })),
      ).resolves.toMatchObject({ ok: true });

      expect(repository.upsertProfile).toHaveBeenCalledWith(
        { userId: 'user-1' },
        expect.objectContaining({
          extras: { other: 'keep' },
        }),
        expect.objectContaining({
          extras: { other: 'keep' },
        }),
      );
    });

    it('should merge emergency contact into extras', async () => {
      repository.findProfileByUserId.mockResolvedValueOnce({ extras: null });

      await expect(
        collectResult(
          service.upsertProfile('user-1', {
            emergencyContactName: '张三',
            emergencyContactPhone: '13800138000',
          }),
        ),
      ).resolves.toMatchObject({ ok: true });

      expect(repository.upsertProfile).toHaveBeenCalledWith(
        { userId: 'user-1' },
        expect.objectContaining({
          extras: {
            emergencyContactName: '张三',
            emergencyContactPhone: '13800138000',
          },
        }),
        expect.objectContaining({
          extras: {
            emergencyContactName: '张三',
            emergencyContactPhone: '13800138000',
          },
        }),
      );
    });

    it('propagates an active-user-not-found failure before any read', async () => {
      ensureActive.mockReturnValue(
        errAsync({ kind: 'not_found', code: 'RESOURCE_NOT_FOUND' }),
      );

      await expect(
        collectResult(service.upsertProfile('user-1', { locale: 'zh-CN' })),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
      expect(repository.findProfileByUserId).not.toHaveBeenCalled();
      expect(repository.upsertProfile).not.toHaveBeenCalled();
    });
  });
});
