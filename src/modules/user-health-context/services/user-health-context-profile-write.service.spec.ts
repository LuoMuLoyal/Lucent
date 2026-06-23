import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { UserHealthContextProfileWriteService } from './user-health-context-profile-write.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserHealthContextGuardService } from '../guards/user-health-context-guard.service';
import { UserHealthContextMapperService } from './user-health-context-mapper.service';

describe('UserHealthContextProfileWriteService', () => {
  let service: UserHealthContextProfileWriteService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserHealthContextProfileWriteService,
        {
          provide: PrismaService,
          useValue: {
            userProfile: {
              findUnique: jest.fn().mockResolvedValue(null),
              upsert: jest.fn(),
            },
          },
        },
        {
          provide: UserHealthContextGuardService,
          useValue: {
            ensureActiveUserExists: jest.fn(),
          },
        },
        {
          provide: UserHealthContextMapperService,
          useValue: {
            normalizePreferenceString: jest
              .fn()
              .mockImplementation((v: string) => v.trim().toLowerCase()),
            dateOnlyStringToUtcDate: jest
              .fn()
              .mockImplementation((v: string | null) =>
                v ? new Date(`${v}T00:00:00.000Z`) : null,
              ),
          },
        },
      ],
    }).compile();

    service = module.get(UserHealthContextProfileWriteService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('upsertProfile', () => {
    it('should upsert a locale field', async () => {
      await service.upsertProfile('user-1', { locale: 'zh-CN' });

      expect(prisma.userProfile.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: expect.objectContaining({ locale: 'zh-cn' }) as object,
        update: expect.objectContaining({ locale: 'zh-cn' }) as object,
      });
    });

    it('should upsert heightCm', async () => {
      await service.upsertProfile('user-1', { heightCm: 170 });

      expect(prisma.userProfile.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: expect.objectContaining({ heightCm: 170 }) as object,
        update: expect.objectContaining({ heightCm: 170 }) as object,
      });
    });

    it('should set onboardingCompletedAt when not yet set', async () => {
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValueOnce({
        onboardingCompletedAt: null,
      });

      await service.upsertProfile('user-1', { onboardingCompleted: true });

      expect(prisma.userProfile.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: expect.objectContaining({
          onboardingCompletedAt: expect.any(Date) as Date,
        }) as object,
        update: expect.objectContaining({
          onboardingCompletedAt: expect.any(Date) as Date,
        }) as object,
      });
    });

    it('should not overwrite onboardingCompletedAt when already set', async () => {
      const existingDate = new Date('2026-01-01T00:00:00Z');
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValueOnce({
        onboardingCompletedAt: existingDate,
      });

      await service.upsertProfile('user-1', { onboardingCompleted: true });

      // upsert is skipped entirely because no fields changed
      expect(prisma.userProfile.upsert).not.toHaveBeenCalled();
    });

    it('should clear onboardingCompletedAt when false', async () => {
      await service.upsertProfile('user-1', { onboardingCompleted: false });

      expect(prisma.userProfile.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: { userId: 'user-1' },
        update: { onboardingCompletedAt: null },
      });
    });

    it('should skip upsert when no fields changed', async () => {
      await service.upsertProfile('user-1', {});

      expect(prisma.userProfile.upsert).not.toHaveBeenCalled();
    });
  });
});
