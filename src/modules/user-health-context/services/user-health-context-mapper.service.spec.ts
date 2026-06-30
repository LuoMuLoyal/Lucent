import { Test } from '@nestjs/testing';
import { UserHealthContextMapperService } from './user-health-context-mapper.service';
import type { UserHealthContextRecord } from '../types/user-health-context.types';

describe('UserHealthContextMapperService', () => {
  let service: UserHealthContextMapperService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [UserHealthContextMapperService],
    }).compile();
    service = module.get(UserHealthContextMapperService);
  });

  function buildRecord(
    overrides?: Partial<UserHealthContextRecord>,
  ): UserHealthContextRecord {
    return {
      id: 'u1',
      profile: {
        birthDate: new Date('1995-06-15'),
        sexAtBirth: 'female',
        heightCm: 165,
        bloodType: 'A',
        locale: 'zh-CN',
        timezone: 'Asia/Shanghai',
        unitSystem: 'metric',
        onboardingCompletedAt: new Date('2026-01-01'),
        extras: null,
      },
      allergies: [
        {
          id: 'a1',
          userId: 'u1',
          kind: 'drug',
          label: '青霉素',
          reaction: '皮疹',
          severity: 'moderate',
          isActive: true,
          note: null,
          recordedAt: new Date('2025-06-01'),
          createdAt: new Date('2025-06-01'),
          updatedAt: new Date('2025-06-01'),
        },
      ],
      conditions: [
        {
          id: 'c1',
          userId: 'u1',
          label: '高血压',
          status: 'active',
          diagnosedAt: new Date('2024-01-01'),
          resolvedAt: null,
          note: null,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ],
      currentMedicines: [
        {
          id: 'm1',
          userId: 'u1',
          source: 'manual',
          sourceRefId: null,
          displayName: '阿莫西林',
          strengthText: '500mg',
          doseText: '每日三次',
          route: '口服',
          isCurrent: true,
          startedAt: new Date('2025-01-01'),
          endedAt: null,
          note: null,
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        },
      ],
      ...overrides,
    } as UserHealthContextRecord;
  }

  describe('toResponse', () => {
    it('maps a complete record to response DTO', () => {
      const result = service.toResponse(buildRecord());

      expect(result.summary.age).toBeGreaterThan(0);
      expect(result.summary.onboardingCompleted).toBe(true);
      expect(result.summary.activeAllergyCount).toBe(1);
      expect(result.summary.conditionCount).toBe(1);
      expect(result.summary.currentMedicineCount).toBe(1);

      expect(result.profile.sexAtBirth).toBe('female');
      expect(result.profile.heightCm).toBe(165);

      expect(result.allergies[0].label).toBe('青霉素');
      expect(result.conditions[0].label).toBe('高血压');
      expect(result.currentMedicines[0].displayName).toBe('阿莫西林');
    });

    it('handles null profile gracefully', () => {
      const result = service.toResponse(buildRecord({ profile: null }));
      expect(result.profile.birthDate).toBeNull();
      expect(result.summary.age).toBeNull();
      expect(result.summary.onboardingCompleted).toBe(false);
      expect(result.summary.missingCoreProfileFields.length).toBeGreaterThan(0);
    });

    it('handles empty arrays', () => {
      const result = service.toResponse(
        buildRecord({ allergies: [], conditions: [], currentMedicines: [] }),
      );
      expect(result.allergies).toEqual([]);
      expect(result.conditions).toEqual([]);
      expect(result.currentMedicines).toEqual([]);
    });

    it('strips internal userId fields from sub-entities', () => {
      const result = service.toResponse(buildRecord());
      expect(result.allergies[0]).not.toHaveProperty('userId');
      expect(result.conditions[0]).not.toHaveProperty('userId');
      expect(result.currentMedicines[0]).not.toHaveProperty('userId');
    });

    it('computes missingCoreProfileFields correctly', () => {
      const record = buildRecord({
        profile: {
          birthDate: null,
          sexAtBirth: null,
          heightCm: null,
          bloodType: null,
          locale: null,
          timezone: null,
          unitSystem: null,
          onboardingCompletedAt: null,
          extras: null,
        },
      });
      const result = service.toResponse(record);
      expect(result.summary.missingCoreProfileFields).toContain('birthDate');
      expect(result.summary.missingCoreProfileFields).toContain('sexAtBirth');
    });

    it('maps resolvedAt date for conditions', () => {
      const record = buildRecord();
      record.conditions[0].resolvedAt = new Date('2025-06-01');
      const result = service.toResponse(record);
      expect(result.conditions[0].resolvedAt).toMatch(/2025-06-01/);
    });

    it('maps endedAt date for current medicines', () => {
      const record = buildRecord();
      record.currentMedicines[0].endedAt = new Date('2025-12-31');
      const result = service.toResponse(record);
      expect(result.currentMedicines[0].endedAt).toMatch(/2025-12-31/);
    });
  });

  describe('dateOnlyStringToUtcDate', () => {
    it('parses a valid date string', () => {
      const result = service.dateOnlyStringToUtcDate('2026-01-15');
      expect(result).toBeInstanceOf(Date);
    });

    it('returns null for null input', () => {
      expect(service.dateOnlyStringToUtcDate(null)).toBeNull();
    });
  });

  describe('toUtcDateOnly', () => {
    it('strips time from a date', () => {
      const input = new Date('2026-06-15T12:30:00Z');
      const result = service.toUtcDateOnly(input);
      expect(result.getUTCHours()).toBe(0);
      expect(result.getUTCMinutes()).toBe(0);
      expect(result.getUTCSeconds()).toBe(0);
    });
  });
});
