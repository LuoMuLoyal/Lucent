/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import {
  LactationState,
  MedicineSource,
  PregnancyState,
  SexAtBirth,
  UnitSystem,
  UserAllergyKind,
  UserAllergySeverity,
  UserConditionStatus,
  UserStatus,
} from '../generated/prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { UserHealthContextService } from './user-health-context.service';
import { ResultCode } from '../common/api-envelope';
import { I18nService } from 'nestjs-i18n';

const mockUserBase = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  passwordHash: '$argon2id$mock',
  nickname: 'TestUser',
  avatar: null,
  status: UserStatus.active,
  emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
  lastLoginAt: new Date('2026-05-28T00:00:00Z'),
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-05-28T00:00:00Z'),
};

describe('UserHealthContextService', () => {
  let service: UserHealthContextService;
  let prismaService: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserHealthContextService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findFirst: jest.fn(),
            },
            userProfile: {
              upsert: jest.fn(),
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: I18nService,
          useValue: {
            t: jest.fn((key: string) => key),
          },
        },
      ],
    }).compile();

    service = module.get(UserHealthContextService);
    prismaService = module.get(PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('should throw NotFoundException when the active user does not exist', async () => {
    (prismaService.user.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(service.getForUser('missing-user')).rejects.toThrow(
      NotFoundException,
    );

    await expect(service.getForUser('missing-user')).rejects.toMatchObject({
      response: {
        code: ResultCode.NOT_FOUND,
        message: 'auth.user_not_found',
      },
    });
  });

  it('should return a stable empty profile shape when the relation is missing', async () => {
    (prismaService.user.findFirst as jest.Mock).mockResolvedValue({
      ...mockUserBase,
      profile: null,
      allergies: [],
      conditions: [],
      currentMedicines: [],
    });

    const result = await service.getForUser(mockUserBase.id);

    expect(prismaService.user.findFirst).toHaveBeenCalledWith({
      where: { id: mockUserBase.id, deletedAt: null },
      include: {
        profile: true,
        allergies: {
          where: { isActive: true },
          orderBy: { updatedAt: 'desc' },
        },
        conditions: {
          orderBy: { updatedAt: 'desc' },
        },
        currentMedicines: {
          where: { isCurrent: true },
          orderBy: { updatedAt: 'desc' },
        },
      },
    });
    expect(result.profile).toEqual({
      birthDate: null,
      sexAtBirth: null,
      heightCm: null,
      pregnancyState: null,
      lactationState: null,
      bloodType: null,
      locale: null,
      timezone: null,
      unitSystem: null,
      onboardingCompletedAt: null,
      extras: null,
    });
    expect(result.summary).toEqual({
      age: null,
      onboardingCompleted: false,
      activeAllergyCount: 0,
      conditionCount: 0,
      currentMedicineCount: 0,
      missingCoreProfileFields: [
        'birthDate',
        'sexAtBirth',
        'heightCm',
        'unitSystem',
      ],
    });
    expect(result.allergies).toEqual([]);
    expect(result.conditions).toEqual([]);
    expect(result.currentMedicines).toEqual([]);
  });

  it('should derive summary counts, age, and formatted dates from stored records', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-30T12:00:00Z'));

    (prismaService.user.findFirst as jest.Mock).mockResolvedValue({
      ...mockUserBase,
      profile: {
        userId: mockUserBase.id,
        birthDate: new Date('1998-03-15T00:00:00.000Z'),
        sexAtBirth: SexAtBirth.female,
        heightCm: 168,
        pregnancyState: PregnancyState.not_pregnant,
        lactationState: LactationState.no,
        bloodType: 'O+',
        locale: 'en-US',
        timezone: 'Asia/Shanghai',
        unitSystem: UnitSystem.metric,
        onboardingCompletedAt: new Date('2026-05-01T08:00:00.000Z'),
        extras: {
          preferredReminderHour: 9,
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-05-29T00:00:00.000Z'),
      },
      allergies: [
        {
          id: 'allergy-1',
          userId: mockUserBase.id,
          kind: UserAllergyKind.drug,
          label: 'Penicillin',
          reaction: 'Rash',
          severity: UserAllergySeverity.severe,
          isActive: true,
          note: 'Avoid completely',
          extras: { source: 'manual' },
          recordedAt: new Date('2026-05-20T09:00:00.000Z'),
          createdAt: new Date('2026-05-20T09:00:00.000Z'),
          updatedAt: new Date('2026-05-21T09:00:00.000Z'),
        },
      ],
      conditions: [
        {
          id: 'condition-1',
          userId: mockUserBase.id,
          label: 'Asthma',
          status: UserConditionStatus.active,
          diagnosedAt: new Date('2024-02-01T00:00:00.000Z'),
          resolvedAt: null,
          note: 'Triggered during pollen season',
          extras: { severityBand: 'moderate' },
          createdAt: new Date('2024-02-01T00:00:00.000Z'),
          updatedAt: new Date('2026-05-18T00:00:00.000Z'),
        },
      ],
      currentMedicines: [
        {
          id: 'medicine-1',
          userId: mockUserBase.id,
          source: MedicineSource.drugbank,
          sourceRefId: 'DB01050',
          displayName: 'Ibuprofen',
          strengthText: '200 mg',
          doseText: '1 tablet after meals',
          route: 'oral',
          startedAt: new Date('2026-05-01T00:00:00.000Z'),
          endedAt: null,
          isCurrent: true,
          note: 'Use only when needed for headaches',
          sourcePayload: { ingredient: 'ibuprofen' },
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
          updatedAt: new Date('2026-05-21T00:00:00.000Z'),
        },
      ],
    });

    const result = await service.getForUser(mockUserBase.id);

    expect(result.summary).toEqual({
      age: 28,
      onboardingCompleted: true,
      activeAllergyCount: 1,
      conditionCount: 1,
      currentMedicineCount: 1,
      missingCoreProfileFields: [],
    });
    expect(result.profile).toEqual({
      birthDate: '1998-03-15',
      sexAtBirth: SexAtBirth.female,
      heightCm: 168,
      pregnancyState: PregnancyState.not_pregnant,
      lactationState: LactationState.no,
      bloodType: 'O+',
      locale: 'en-US',
      timezone: 'Asia/Shanghai',
      unitSystem: UnitSystem.metric,
      onboardingCompletedAt: '2026-05-01T08:00:00.000Z',
      extras: { preferredReminderHour: 9 },
    });
    expect(result.allergies[0]).toEqual({
      id: 'allergy-1',
      kind: UserAllergyKind.drug,
      label: 'Penicillin',
      reaction: 'Rash',
      severity: UserAllergySeverity.severe,
      isActive: true,
      note: 'Avoid completely',
      extras: { source: 'manual' },
      recordedAt: '2026-05-20T09:00:00.000Z',
      createdAt: '2026-05-20T09:00:00.000Z',
      updatedAt: '2026-05-21T09:00:00.000Z',
    });
    expect(result.conditions[0]).toEqual({
      id: 'condition-1',
      label: 'Asthma',
      status: UserConditionStatus.active,
      diagnosedAt: '2024-02-01',
      resolvedAt: null,
      note: 'Triggered during pollen season',
      extras: { severityBand: 'moderate' },
      createdAt: '2024-02-01T00:00:00.000Z',
      updatedAt: '2026-05-18T00:00:00.000Z',
    });
    expect(result.currentMedicines[0]).toEqual({
      id: 'medicine-1',
      source: MedicineSource.drugbank,
      sourceRefId: 'DB01050',
      displayName: 'Ibuprofen',
      strengthText: '200 mg',
      doseText: '1 tablet after meals',
      route: 'oral',
      startedAt: '2026-05-01',
      endedAt: null,
      isCurrent: true,
      note: 'Use only when needed for headaches',
      sourcePayload: { ingredient: 'ibuprofen' },
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-21T00:00:00.000Z',
    });
  });

  it('should upsert profile fields and return the refreshed aggregate', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-05T12:00:00Z'));

    (prismaService.user.findFirst as jest.Mock)
      .mockResolvedValueOnce({ id: mockUserBase.id })
      .mockResolvedValueOnce({
        ...mockUserBase,
        profile: {
          userId: mockUserBase.id,
          birthDate: new Date('1998-03-15T00:00:00.000Z'),
          sexAtBirth: SexAtBirth.female,
          heightCm: 168,
          pregnancyState: PregnancyState.not_pregnant,
          lactationState: LactationState.no,
          bloodType: 'O+',
          locale: 'zh-CN',
          timezone: 'Asia/Shanghai',
          unitSystem: UnitSystem.metric,
          onboardingCompletedAt: new Date('2026-06-05T12:00:00.000Z'),
          extras: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-05-29T00:00:00.000Z'),
        },
        allergies: [],
        conditions: [],
        currentMedicines: [],
      });

    (prismaService.userProfile.findUnique as jest.Mock).mockResolvedValue({
      onboardingCompletedAt: null,
    });

    const result = await service.updateProfile(mockUserBase.id, {
      locale: ' zh-CN ',
      timezone: '',
      unitSystem: UnitSystem.metric,
      birthDate: '1998-03-15',
      sexAtBirth: SexAtBirth.female,
      heightCm: 168,
      pregnancyState: PregnancyState.not_pregnant,
      lactationState: LactationState.no,
      bloodType: ' O+ ',
      onboardingCompleted: true,
    });

    expect(prismaService.userProfile.upsert).toHaveBeenCalledWith({
      where: { userId: mockUserBase.id },
      create: {
        userId: mockUserBase.id,
        locale: 'zh-CN',
        timezone: null,
        unitSystem: UnitSystem.metric,
        birthDate: new Date('1998-03-15T00:00:00.000Z'),
        sexAtBirth: SexAtBirth.female,
        heightCm: 168,
        pregnancyState: PregnancyState.not_pregnant,
        lactationState: LactationState.no,
        bloodType: 'O+',
      },
      update: expect.objectContaining({
        locale: 'zh-CN',
        timezone: null,
        unitSystem: UnitSystem.metric,
        birthDate: new Date('1998-03-15T00:00:00.000Z'),
        sexAtBirth: SexAtBirth.female,
        heightCm: 168,
        pregnancyState: PregnancyState.not_pregnant,
        lactationState: LactationState.no,
        bloodType: 'O+',
        onboardingCompletedAt: expect.any(Date),
      }),
    });
    expect(result.profile.locale).toBe('zh-CN');
    expect(result.profile.birthDate).toBe('1998-03-15');
    expect(result.profile.sexAtBirth).toBe(SexAtBirth.female);
    expect(result.profile.heightCm).toBe(168);
    expect(result.profile.bloodType).toBe('O+');
    expect(result.summary.onboardingCompleted).toBe(true);
  });

  it('should clear nullable profile fields when sending null', async () => {
    (prismaService.user.findFirst as jest.Mock)
      .mockResolvedValueOnce({ id: mockUserBase.id })
      .mockResolvedValueOnce({
        ...mockUserBase,
        profile: {
          userId: mockUserBase.id,
          birthDate: null,
          sexAtBirth: null,
          heightCm: null,
          pregnancyState: null,
          lactationState: null,
          bloodType: null,
          locale: null,
          timezone: null,
          unitSystem: null,
          onboardingCompletedAt: null,
          extras: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-05-29T00:00:00.000Z'),
        },
        allergies: [],
        conditions: [],
        currentMedicines: [],
      });

    await service.updateProfile(mockUserBase.id, {
      birthDate: null,
      sexAtBirth: null,
      heightCm: null,
      pregnancyState: null,
      lactationState: null,
      bloodType: null,
      unitSystem: null,
    });

    expect(prismaService.userProfile.upsert).toHaveBeenCalledWith({
      where: { userId: mockUserBase.id },
      create: expect.objectContaining({
        birthDate: null,
        sexAtBirth: null,
        heightCm: null,
        pregnancyState: null,
        lactationState: null,
        bloodType: null,
        unitSystem: null,
      }),
      update: expect.objectContaining({
        birthDate: null,
        sexAtBirth: null,
        heightCm: null,
        pregnancyState: null,
        lactationState: null,
        bloodType: null,
        unitSystem: null,
      }),
    });
  });

  it('should set onboardingCompletedAt when onboardingCompleted is true and not yet set', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-05T12:00:00Z'));

    (prismaService.user.findFirst as jest.Mock)
      .mockResolvedValueOnce({ id: mockUserBase.id })
      .mockResolvedValueOnce({
        ...mockUserBase,
        profile: {
          userId: mockUserBase.id,
          birthDate: null,
          sexAtBirth: null,
          heightCm: null,
          pregnancyState: null,
          lactationState: null,
          bloodType: null,
          locale: null,
          timezone: null,
          unitSystem: null,
          onboardingCompletedAt: new Date('2026-06-05T12:00:00.000Z'),
          extras: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-05-29T00:00:00.000Z'),
        },
        allergies: [],
        conditions: [],
        currentMedicines: [],
      });

    (prismaService.userProfile.findUnique as jest.Mock).mockResolvedValue({
      onboardingCompletedAt: null,
    });

    await service.updateProfile(mockUserBase.id, {
      onboardingCompleted: true,
    });

    expect(prismaService.userProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          onboardingCompletedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('should not overwrite onboardingCompletedAt when already set', async () => {
    const existingDate = new Date('2026-05-01T08:00:00.000Z');

    (prismaService.user.findFirst as jest.Mock)
      .mockResolvedValueOnce({ id: mockUserBase.id })
      .mockResolvedValueOnce({
        ...mockUserBase,
        profile: {
          userId: mockUserBase.id,
          birthDate: null,
          sexAtBirth: null,
          heightCm: null,
          pregnancyState: null,
          lactationState: null,
          bloodType: null,
          locale: null,
          timezone: null,
          unitSystem: null,
          onboardingCompletedAt: existingDate,
          extras: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-05-29T00:00:00.000Z'),
        },
        allergies: [],
        conditions: [],
        currentMedicines: [],
      });

    (prismaService.userProfile.findUnique as jest.Mock).mockResolvedValue({
      onboardingCompletedAt: existingDate,
    });

    await service.updateProfile(mockUserBase.id, {
      onboardingCompleted: true,
    });

    // upsert should NOT be called because updateData is empty
    // (onboardingCompletedAt was already set, so nothing to update)
    expect(prismaService.userProfile.upsert).not.toHaveBeenCalled();
  });

  it('should clear onboardingCompletedAt when onboardingCompleted is false', async () => {
    (prismaService.user.findFirst as jest.Mock)
      .mockResolvedValueOnce({ id: mockUserBase.id })
      .mockResolvedValueOnce({
        ...mockUserBase,
        profile: {
          userId: mockUserBase.id,
          birthDate: null,
          sexAtBirth: null,
          heightCm: null,
          pregnancyState: null,
          lactationState: null,
          bloodType: null,
          locale: null,
          timezone: null,
          unitSystem: null,
          onboardingCompletedAt: null,
          extras: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-05-29T00:00:00.000Z'),
        },
        allergies: [],
        conditions: [],
        currentMedicines: [],
      });

    await service.updateProfile(mockUserBase.id, {
      onboardingCompleted: false,
    });

    expect(prismaService.userProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          onboardingCompletedAt: null,
        }),
      }),
    );
  });
});
