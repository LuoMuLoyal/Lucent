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
} from '../../generated/prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { UserHealthContextGuardService } from './user-health-context-guard.service';
import { UserHealthContextMapperService } from './user-health-context-mapper.service';
import { UserHealthContextService } from './user-health-context.service';
import { ResultCode } from '../../common/api-envelope';
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
        UserHealthContextGuardService,
        UserHealthContextMapperService,
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
            userAllergy: {
              create: jest.fn(),
              update: jest.fn(),
              findUnique: jest.fn(),
            },
            userCondition: {
              create: jest.fn(),
              update: jest.fn(),
              findUnique: jest.fn(),
            },
            userCurrentMedicine: {
              create: jest.fn(),
              update: jest.fn(),
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
        onboardingCompletedAt: expect.any(Date),
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

  it('should include onboardingCompletedAt when completing onboarding creates a profile', async () => {
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

    (prismaService.userProfile.findUnique as jest.Mock).mockResolvedValue(null);

    await service.updateProfile(mockUserBase.id, {
      onboardingCompleted: true,
    });

    expect(prismaService.userProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          onboardingCompletedAt: new Date('2026-06-05T12:00:00.000Z'),
        }),
        update: expect.objectContaining({
          onboardingCompletedAt: new Date('2026-06-05T12:00:00.000Z'),
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

  // ── Allergy tests ──

  it('should create an allergy and return the refreshed aggregate', async () => {
    (prismaService.user.findFirst as jest.Mock)
      .mockResolvedValueOnce({ id: mockUserBase.id })
      .mockResolvedValueOnce({
        ...mockUserBase,
        profile: null,
        allergies: [
          {
            id: 'allergy-1',
            userId: mockUserBase.id,
            kind: UserAllergyKind.drug,
            label: 'Penicillin',
            reaction: 'Rash',
            severity: UserAllergySeverity.moderate,
            isActive: true,
            note: null,
            extras: null,
            recordedAt: new Date('2026-06-03T09:00:00.000Z'),
            createdAt: new Date('2026-06-03T09:00:00.000Z'),
            updatedAt: new Date('2026-06-03T09:00:00.000Z'),
          },
        ],
        conditions: [],
        currentMedicines: [],
      });

    const result = await service.createAllergy(mockUserBase.id, {
      kind: UserAllergyKind.drug,
      label: ' Penicillin ',
      reaction: 'Rash',
      severity: UserAllergySeverity.moderate,
      recordedAt: '2026-06-03T09:00:00.000Z',
    });

    expect(prismaService.userAllergy.create).toHaveBeenCalledWith({
      data: {
        userId: mockUserBase.id,
        kind: UserAllergyKind.drug,
        label: 'Penicillin',
        reaction: 'Rash',
        severity: UserAllergySeverity.moderate,
        note: null,
        recordedAt: new Date('2026-06-03T09:00:00.000Z'),
      },
    });
    expect(result.allergies).toHaveLength(1);
    expect(result.allergies[0].label).toBe('Penicillin');
  });

  it('should update an allergy and return the refreshed aggregate', async () => {
    (prismaService.userAllergy.findUnique as jest.Mock).mockResolvedValue({
      userId: mockUserBase.id,
    });
    (prismaService.user.findFirst as jest.Mock).mockResolvedValue({
      ...mockUserBase,
      profile: null,
      allergies: [
        {
          id: 'allergy-1',
          userId: mockUserBase.id,
          kind: UserAllergyKind.drug,
          label: 'Penicillin Updated',
          reaction: null,
          severity: UserAllergySeverity.mild,
          isActive: true,
          note: 'Updated note',
          extras: null,
          recordedAt: null,
          createdAt: new Date('2026-06-03T09:00:00.000Z'),
          updatedAt: new Date('2026-06-03T09:00:00.000Z'),
        },
      ],
      conditions: [],
      currentMedicines: [],
    });

    const result = await service.updateAllergy(mockUserBase.id, 'allergy-1', {
      label: ' Penicillin Updated ',
      severity: UserAllergySeverity.mild,
      note: 'Updated note',
      reaction: null,
    });

    expect(prismaService.userAllergy.update).toHaveBeenCalledWith({
      where: { id: 'allergy-1' },
      data: expect.objectContaining({
        label: 'Penicillin Updated',
        severity: UserAllergySeverity.mild,
        note: 'Updated note',
        reaction: null,
      }),
    });
    expect(result.allergies[0].label).toBe('Penicillin Updated');
  });

  it('should soft-delete an allergy (set isActive=false)', async () => {
    (prismaService.userAllergy.findUnique as jest.Mock).mockResolvedValue({
      userId: mockUserBase.id,
    });
    (prismaService.user.findFirst as jest.Mock).mockResolvedValue({
      ...mockUserBase,
      profile: null,
      allergies: [],
      conditions: [],
      currentMedicines: [],
    });

    const result = await service.deleteAllergy(mockUserBase.id, 'allergy-1');

    expect(prismaService.userAllergy.update).toHaveBeenCalledWith({
      where: { id: 'allergy-1' },
      data: { isActive: false },
    });
    expect(result.allergies).toHaveLength(0);
  });

  it('should throw NotFoundException when updating a foreign allergy', async () => {
    (prismaService.userAllergy.findUnique as jest.Mock).mockResolvedValue({
      userId: 'other-user',
    });

    await expect(
      service.updateAllergy(mockUserBase.id, 'allergy-1', { label: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });

  // ── Condition tests ──

  it('should create a condition and return the refreshed aggregate', async () => {
    (prismaService.user.findFirst as jest.Mock)
      .mockResolvedValueOnce({ id: mockUserBase.id })
      .mockResolvedValueOnce({
        ...mockUserBase,
        profile: null,
        allergies: [],
        conditions: [
          {
            id: 'cond-1',
            userId: mockUserBase.id,
            label: 'Asthma',
            status: UserConditionStatus.active,
            diagnosedAt: new Date('2024-02-01T00:00:00.000Z'),
            resolvedAt: null,
            note: 'Triggered during pollen season',
            extras: null,
            createdAt: new Date('2026-06-03T09:00:00.000Z'),
            updatedAt: new Date('2026-06-03T09:00:00.000Z'),
          },
        ],
        currentMedicines: [],
      });

    const result = await service.createCondition(mockUserBase.id, {
      label: ' Asthma ',
      status: UserConditionStatus.active,
      diagnosedAt: '2024-02-01',
      note: 'Triggered during pollen season',
    });

    expect(prismaService.userCondition.create).toHaveBeenCalledWith({
      data: {
        user: { connect: { id: mockUserBase.id } },
        label: 'Asthma',
        status: UserConditionStatus.active,
        diagnosedAt: new Date('2024-02-01T00:00:00.000Z'),
        note: 'Triggered during pollen season',
      },
    });
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0].label).toBe('Asthma');
  });

  it('should update a condition and return the refreshed aggregate', async () => {
    (prismaService.userCondition.findUnique as jest.Mock).mockResolvedValue({
      userId: mockUserBase.id,
    });
    (prismaService.user.findFirst as jest.Mock).mockResolvedValue({
      ...mockUserBase,
      profile: null,
      allergies: [],
      conditions: [
        {
          id: 'cond-1',
          userId: mockUserBase.id,
          label: 'Asthma Updated',
          status: UserConditionStatus.suspected,
          diagnosedAt: null,
          resolvedAt: null,
          note: null,
          extras: null,
          createdAt: new Date('2026-06-03T09:00:00.000Z'),
          updatedAt: new Date('2026-06-03T09:00:00.000Z'),
        },
      ],
      currentMedicines: [],
    });

    const result = await service.updateCondition(mockUserBase.id, 'cond-1', {
      label: ' Asthma Updated ',
      status: UserConditionStatus.suspected,
      diagnosedAt: null,
    });

    expect(prismaService.userCondition.update).toHaveBeenCalledWith({
      where: { id: 'cond-1' },
      data: expect.objectContaining({
        label: 'Asthma Updated',
        status: UserConditionStatus.suspected,
        diagnosedAt: null,
      }),
    });
    expect(result.conditions[0].label).toBe('Asthma Updated');
    expect(result.conditions[0].status).toBe(UserConditionStatus.suspected);
  });

  it('should soft-resolve a condition (set status=resolved)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-03T12:00:00Z'));

    (prismaService.userCondition.findUnique as jest.Mock)
      .mockResolvedValueOnce({ userId: mockUserBase.id })
      .mockResolvedValueOnce({ resolvedAt: null });
    (prismaService.user.findFirst as jest.Mock).mockResolvedValue({
      ...mockUserBase,
      profile: null,
      allergies: [],
      conditions: [
        {
          id: 'cond-1',
          userId: mockUserBase.id,
          label: 'Asthma',
          status: UserConditionStatus.resolved,
          diagnosedAt: new Date('2024-02-01T00:00:00.000Z'),
          resolvedAt: new Date('2026-06-03T00:00:00.000Z'),
          note: null,
          extras: null,
          createdAt: new Date('2026-06-03T09:00:00.000Z'),
          updatedAt: new Date('2026-06-03T09:00:00.000Z'),
        },
      ],
      currentMedicines: [],
    });

    const result = await service.deleteCondition(mockUserBase.id, 'cond-1');

    expect(prismaService.userCondition.update).toHaveBeenCalledWith({
      where: { id: 'cond-1' },
      data: {
        status: 'resolved',
        resolvedAt: new Date('2026-06-03T00:00:00.000Z'),
      },
    });
    expect(result.conditions[0].status).toBe(UserConditionStatus.resolved);
  });

  it('should throw NotFoundException when updating a foreign condition', async () => {
    (prismaService.userCondition.findUnique as jest.Mock).mockResolvedValue({
      userId: 'other-user',
    });

    await expect(
      service.updateCondition(mockUserBase.id, 'cond-1', { label: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });

  // ── Current medicine tests ──

  it('should create a current medicine and return the refreshed aggregate', async () => {
    (prismaService.user.findFirst as jest.Mock)
      .mockResolvedValueOnce({ id: mockUserBase.id })
      .mockResolvedValueOnce({
        ...mockUserBase,
        profile: null,
        allergies: [],
        conditions: [],
        currentMedicines: [
          {
            id: 'med-1',
            userId: mockUserBase.id,
            source: MedicineSource.drugbank,
            sourceRefId: 'DB01050',
            displayName: 'Ibuprofen',
            strengthText: '200 mg',
            doseText: '1 tablet after meals',
            route: 'oral',
            startedAt: new Date('2026-06-03T00:00:00.000Z'),
            endedAt: null,
            isCurrent: true,
            note: null,
            sourcePayload: null,
            createdAt: new Date('2026-06-03T09:00:00.000Z'),
            updatedAt: new Date('2026-06-03T09:00:00.000Z'),
          },
        ],
      });

    const result = await service.createCurrentMedicine(mockUserBase.id, {
      source: MedicineSource.drugbank,
      sourceRefId: 'DB01050',
      displayName: ' Ibuprofen ',
      strengthText: '200 mg',
      doseText: '1 tablet after meals',
      route: 'oral',
      startedAt: '2026-06-03',
    });

    expect(prismaService.userCurrentMedicine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: mockUserBase.id,
        source: MedicineSource.drugbank,
        sourceRefId: 'DB01050',
        displayName: 'Ibuprofen',
        strengthText: '200 mg',
        doseText: '1 tablet after meals',
        route: 'oral',
        startedAt: new Date('2026-06-03T00:00:00.000Z'),
      }),
    });
    expect(result.currentMedicines).toHaveLength(1);
    expect(result.currentMedicines[0].displayName).toBe('Ibuprofen');
  });

  it('should create a manual current medicine without sourceRefId', async () => {
    (prismaService.user.findFirst as jest.Mock)
      .mockResolvedValueOnce({ id: mockUserBase.id })
      .mockResolvedValueOnce({
        ...mockUserBase,
        profile: null,
        allergies: [],
        conditions: [],
        currentMedicines: [
          {
            id: 'med-1',
            userId: mockUserBase.id,
            source: MedicineSource.manual,
            sourceRefId: null,
            displayName: 'Vitamin D',
            strengthText: null,
            doseText: null,
            route: null,
            startedAt: null,
            endedAt: null,
            isCurrent: true,
            note: null,
            sourcePayload: null,
            createdAt: new Date('2026-06-03T09:00:00.000Z'),
            updatedAt: new Date('2026-06-03T09:00:00.000Z'),
          },
        ],
      });

    const result = await service.createCurrentMedicine(mockUserBase.id, {
      source: MedicineSource.manual,
      displayName: 'Vitamin D',
    });

    expect(prismaService.userCurrentMedicine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: MedicineSource.manual,
        sourceRefId: null,
        displayName: 'Vitamin D',
      }),
    });
    expect(result.currentMedicines[0].source).toBe(MedicineSource.manual);
    expect(result.currentMedicines[0].sourceRefId).toBeNull();
  });

  it('should update a current medicine', async () => {
    (
      prismaService.userCurrentMedicine.findUnique as jest.Mock
    ).mockResolvedValue({ userId: mockUserBase.id });
    (prismaService.user.findFirst as jest.Mock).mockResolvedValue({
      ...mockUserBase,
      profile: null,
      allergies: [],
      conditions: [],
      currentMedicines: [
        {
          id: 'med-1',
          userId: mockUserBase.id,
          source: MedicineSource.drugbank,
          sourceRefId: 'DB01050',
          displayName: 'Ibuprofen Updated',
          strengthText: '400 mg',
          doseText: null,
          route: null,
          startedAt: new Date('2026-06-03T00:00:00.000Z'),
          endedAt: null,
          isCurrent: true,
          note: 'Updated note',
          sourcePayload: null,
          createdAt: new Date('2026-06-03T09:00:00.000Z'),
          updatedAt: new Date('2026-06-03T09:00:00.000Z'),
        },
      ],
    });

    const result = await service.updateCurrentMedicine(
      mockUserBase.id,
      'med-1',
      {
        displayName: ' Ibuprofen Updated ',
        strengthText: '400 mg',
        note: 'Updated note',
      },
    );

    expect(prismaService.userCurrentMedicine.update).toHaveBeenCalledWith({
      where: { id: 'med-1' },
      data: expect.objectContaining({
        displayName: 'Ibuprofen Updated',
        strengthText: '400 mg',
        note: 'Updated note',
      }),
    });
    expect(result.currentMedicines[0].displayName).toBe('Ibuprofen Updated');
  });

  it('should soft-delete a current medicine (set isCurrent=false)', async () => {
    (prismaService.userCurrentMedicine.findUnique as jest.Mock)
      .mockResolvedValueOnce({ userId: mockUserBase.id })
      .mockResolvedValueOnce({ endedAt: null });
    (prismaService.user.findFirst as jest.Mock).mockResolvedValue({
      ...mockUserBase,
      profile: null,
      allergies: [],
      conditions: [],
      currentMedicines: [],
    });

    const result = await service.deleteCurrentMedicine(
      mockUserBase.id,
      'med-1',
    );

    expect(prismaService.userCurrentMedicine.update).toHaveBeenCalledWith({
      where: { id: 'med-1' },
      data: {
        isCurrent: false,
        endedAt: expect.any(Date),
      },
    });
    expect(result.currentMedicines).toHaveLength(0);
  });

  it('should throw NotFoundException when accessing a foreign current medicine', async () => {
    (
      prismaService.userCurrentMedicine.findUnique as jest.Mock
    ).mockResolvedValue({ userId: 'other-user' });

    await expect(
      service.updateCurrentMedicine(mockUserBase.id, 'med-1', {
        displayName: 'X',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
