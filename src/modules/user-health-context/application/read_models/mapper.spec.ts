import { Test } from '@nestjs/testing';
import { UserHealthContextMapper } from '../read_models/mapper.js';

describe('UserHealthContextMapper', () => {
  let service: UserHealthContextMapper;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [UserHealthContextMapper],
    }).compile();
    service = module.get(UserHealthContextMapper);
  });

  it('maps a complete record', () => {
    const result = service.toResponse({
      id: 'u1',
      profile: {
        birthDate: new Date('1995-06-15'),
        sexAtBirth: 'female' as any,
        heightCm: 165,
        activityLevel: 'moderatelyActive' as any,
        locale: 'zh-CN',
        timezone: 'Asia/Shanghai',
        unitSystem: 'metric' as any,
        onboardingCompletedAt: new Date('2026-01-01'),
        extras: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: 'u1',
      },
      allergies: [
        {
          id: 'a1',
          userId: 'u1',
          kind: 'drug' as any,
          label: '青霉素',
          reaction: '皮疹',
          severity: 'moderate' as any,
          isActive: true,
          note: null,
          recordedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      conditions: [],
      currentMedicines: [],
    } as any);
    expect(result.summary.age).toBeGreaterThan(0);
    expect(result.allergies).toHaveLength(1);
  });

  it('handles null profile', () => {
    const result = service.toResponse({
      id: 'u1',
      profile: null,
      allergies: [],
      conditions: [],
      currentMedicines: [],
    } as any);
    expect(result.profile.birthDate).toBeNull();
  });
});
