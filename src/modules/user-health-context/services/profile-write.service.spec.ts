import { parseDateOnly } from '../../../common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { type Mocked } from 'vitest';
import { UserHealthContextProfileWriteService } from './profile-write.service';
import { UserHealthContextRepositoryPort } from '../repositories/health-context.repository';
import { UserHealthContextOwnershipService } from '../services/ownership.service';
import { UserHealthContextMapperService } from './mapper.service';

describe('UserHealthContextProfileWriteService', () => {
  let service: UserHealthContextProfileWriteService;

  let repository: Mocked<UserHealthContextRepositoryPort>;

  beforeEach(async () => {
    repository = {
      findProfileByUserId: vi.fn().mockResolvedValue(null),
      upsertProfile: vi.fn(),
    } as unknown as Mocked<UserHealthContextRepositoryPort>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserHealthContextProfileWriteService,
        { provide: UserHealthContextRepositoryPort, useValue: repository },
        {
          provide: UserHealthContextOwnershipService,
          useValue: {
            ensureActiveUserExists: vi.fn(),
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
      await service.upsertProfile('user-1', { locale: 'zh-CN' });

      expect(repository.upsertProfile).toHaveBeenCalledWith(
        { userId: 'user-1' },
        expect.objectContaining({ locale: 'zh-CN' }),
        expect.objectContaining({ locale: 'zh-CN' }),
      );
    });

    it('should upsert heightCm', async () => {
      await service.upsertProfile('user-1', { heightCm: 170 });

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

      await service.upsertProfile('user-1', { onboardingCompleted: true });

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

      await service.upsertProfile('user-1', { onboardingCompleted: true });

      expect(repository.upsertProfile).not.toHaveBeenCalled();
    });

    it('should clear onboardingCompletedAt when false', async () => {
      await service.upsertProfile('user-1', { onboardingCompleted: false });

      expect(repository.upsertProfile).toHaveBeenCalledWith(
        { userId: 'user-1' },
        { userId: 'user-1' },
        { onboardingCompletedAt: null },
      );
    });

    it('should skip upsert when no fields changed', async () => {
      await service.upsertProfile('user-1', {});

      expect(repository.upsertProfile).not.toHaveBeenCalled();
    });
  });
});
