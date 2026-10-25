import { okAsync } from '../../../../../common/result/index.js';
import { IUserHealthContextReader } from '../../../../user-health-context/index.js';
import type { HealthContextResponseData } from '../../../../user-health-context/index.js';
import { ProfileCollectorService } from './profile.js';
import { TriggerType } from '../../../domain/suggestion/suggestion.types.js';

/**
 * The collector reads through the User Profile context's reader port, so the
 * fake is a plain object satisfying that port — no Prisma mock. A Prisma-shaped
 * double would let the test pass while the production path read another
 * context's tables directly, which is the coupling this port exists to remove.
 */
function readerFor(
  data: Partial<HealthContextResponseData>,
): IUserHealthContextReader {
  return {
    getForUser: () =>
      okAsync({
        summary: {},
        profile: { birthDate: null, sexAtBirth: null, heightCm: null },
        allergies: [],
        conditions: [],
        currentMedicines: [],
        ...data,
      } as unknown as HealthContextResponseData),
  } as unknown as IUserHealthContextReader;
}

function allergies(active: number): HealthContextResponseData['allergies'] {
  return Array.from({ length: active }, (_, i) => ({
    id: `a-${String(i)}`,
    isActive: true,
  })) as unknown as HealthContextResponseData['allergies'];
}

function conditions(active: number): HealthContextResponseData['conditions'] {
  return Array.from({ length: active }, (_, i) => ({
    id: `c-${String(i)}`,
    status: 'active',
  })) as unknown as HealthContextResponseData['conditions'];
}

describe('ProfileCollectorService', () => {
  it('returns a profile_completeness signal with all fields missing when profile is empty', async () => {
    const service = new ProfileCollectorService(readerFor({}));

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
    const service = new ProfileCollectorService(
      readerFor({
        profile: {
          birthDate: '1990-01-01',
          sexAtBirth: 'male',
          heightCm: 175,
        },
        allergies: allergies(2),
        conditions: conditions(1),
      } as Partial<HealthContextResponseData>),
    );

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
    const service = new ProfileCollectorService(
      readerFor({
        profile: {
          birthDate: '1990-01-01',
          sexAtBirth: null,
          heightCm: null,
        },
      } as Partial<HealthContextResponseData>),
    );

    const signals = await service.collect('user-1', '2026-07-09');

    expect(signals[0]!.payload).toMatchObject({
      missingFields: ['sexAtBirth', 'heightCm'],
      isComplete: false,
    });
  });

  it('counts only active allergies and conditions', async () => {
    const inactive = {
      id: 'a-x',
      isActive: false,
    } as unknown as HealthContextResponseData['allergies'][number];
    const service = new ProfileCollectorService(
      readerFor({
        allergies: [...allergies(2), inactive],
        conditions: [
          ...conditions(1),
          {
            id: 'c-x',
            status: 'resolved',
          } as unknown as HealthContextResponseData['conditions'][number],
        ],
      }),
    );

    const signals = await service.collect('user-1', '2026-07-09');

    expect(signals[0]!.payload).toMatchObject({
      activeAllergyCount: 2,
      activeConditionCount: 1,
    });
  });

  it('includes the signalId with the date', async () => {
    const service = new ProfileCollectorService(readerFor({}));

    const signals = await service.collect('user-1', '2026-07-09');

    expect(signals[0]!.signalId).toBe('profile_summary_2026-07-09');
  });
});
