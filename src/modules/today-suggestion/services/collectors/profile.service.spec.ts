import type { DeepMocked } from '../../../../common/types/deep-mocked';
import type { PrismaService } from '../../../../prisma';
import { ProfileCollectorService } from './profile.service';
import { TriggerType } from '../../../today-suggestion/types';

describe('ProfileCollectorService', () => {
  let service: ProfileCollectorService;
  let prisma: DeepMocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      userAllergy: { count: vi.fn() },
      userCondition: { count: vi.fn() },
      userProfile: { findUnique: vi.fn() },
    } as unknown as DeepMocked<PrismaService>;
    service = new ProfileCollectorService(prisma);
  });

  it('returns a profile_completeness signal with all fields missing when profile is null', async () => {
    (prisma.userAllergy.count as vi.Mock).mockResolvedValue(0);
    (prisma.userCondition.count as vi.Mock).mockResolvedValue(0);
    (prisma.userProfile.findUnique as vi.Mock).mockResolvedValue(null);

    const signals = await service.collect('user-1', '2026-07-09');

    expect(signals).toHaveLength(1);
    const signal = signals[0]!;
    expect(signal.kind).toBe('profile_completeness');
    expect(signal.source).toBe('profile');
    expect(signal.triggerType).toBe(TriggerType.TIMER);
    expect(signal.payload).toMatchObject({
      activeAllergyCount: 0,
      activeConditionCount: 0,
      missingFields: ['birthDate', 'sexAtBirth', 'heightCm'],
      isComplete: false,
    });
  });

  it('returns isComplete=true when all required fields are present', async () => {
    (prisma.userAllergy.count as vi.Mock).mockResolvedValue(2);
    (prisma.userCondition.count as vi.Mock).mockResolvedValue(1);
    (prisma.userProfile.findUnique as vi.Mock).mockResolvedValue({
      birthDate: new Date('1990-01-01'),
      sexAtBirth: 'male',
      heightCm: 175,
      bloodType: 'A',
    });

    const signals = await service.collect('user-1', '2026-07-09');

    expect(signals).toHaveLength(1);
    expect(signals[0]!.payload).toMatchObject({
      activeAllergyCount: 2,
      activeConditionCount: 1,
      missingFields: [],
      isComplete: true,
    });
  });

  it('reports missing fields partially when only some are null', async () => {
    (prisma.userAllergy.count as vi.Mock).mockResolvedValue(0);
    (prisma.userCondition.count as vi.Mock).mockResolvedValue(0);
    (prisma.userProfile.findUnique as vi.Mock).mockResolvedValue({
      birthDate: new Date('1990-01-01'),
      sexAtBirth: null,
      heightCm: null,
      bloodType: null,
    });

    const signals = await service.collect('user-1', '2026-07-09');

    expect(signals[0]!.payload).toMatchObject({
      missingFields: ['sexAtBirth', 'heightCm'],
      isComplete: false,
    });
  });

  it('includes the signalId with the date', async () => {
    (prisma.userAllergy.count as vi.Mock).mockResolvedValue(0);
    (prisma.userCondition.count as vi.Mock).mockResolvedValue(0);
    (prisma.userProfile.findUnique as vi.Mock).mockResolvedValue(null);

    const signals = await service.collect('user-1', '2026-07-09');

    expect(signals[0]!.signalId).toBe('profile_summary_2026-07-09');
  });
});
