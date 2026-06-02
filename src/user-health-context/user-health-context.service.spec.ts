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

  it('should upsert profile preferences and return the refreshed aggregate', async () => {
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
          locale: 'zh-CN',
          timezone: 'Asia/Shanghai',
          unitSystem: UnitSystem.metric,
          onboardingCompletedAt: null,
          extras: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-05-29T00:00:00.000Z'),
        },
        allergies: [],
        conditions: [],
        currentMedicines: [],
      });

    const result = await service.updateProfilePreferences(mockUserBase.id, {
      locale: ' zh-CN ',
      timezone: '',
      unitSystem: UnitSystem.metric,
    });

    expect(prismaService.userProfile.upsert).toHaveBeenCalledWith({
      where: { userId: mockUserBase.id },
      create: {
        userId: mockUserBase.id,
        locale: 'zh-CN',
        timezone: null,
        unitSystem: UnitSystem.metric,
      },
      update: {
        locale: 'zh-CN',
        timezone: null,
        unitSystem: UnitSystem.metric,
      },
    });
    expect(result.profile.locale).toBe('zh-CN');
    expect(result.profile.timezone).toBe('Asia/Shanghai');
    expect(result.profile.unitSystem).toBe(UnitSystem.metric);
  });
});
