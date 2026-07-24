import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma';
import { parseDateOnly } from '../../../../common';
import type { SuggestionSignal } from '../../types/signal.types';
import { TriggerType } from '../../types/suggestion.types';

/**
 * Collects health-profile signals: allergies, conditions,
 * and profile completeness for coverage rules.
 */
@Injectable()
export class ProfileCollectorService {
  constructor(private readonly prisma: PrismaService) {}

  async collect(userId: string, date: string): Promise<SuggestionSignal[]> {
    const day = parseDateOnly(date);

    const [activeAllergyCount, activeConditions, profile] = await Promise.all([
      this.prisma.userAllergy.count({
        where: { userId, isActive: true },
      }),
      this.prisma.userCondition.count({
        where: { userId, status: 'active' },
      }),
      this.prisma.userProfile.findUnique({
        where: { userId },
        select: {
          birthDate: true,
          sexAtBirth: true,
          heightCm: true,
          bloodType: true,
        },
      }),
    ]);

    const signals: SuggestionSignal[] = [];

    // Profile completeness signal
    const missingFields: string[] = [];
    if (profile?.birthDate == null) missingFields.push('birthDate');
    if (profile?.sexAtBirth == null) missingFields.push('sexAtBirth');
    if (profile?.heightCm == null) missingFields.push('heightCm');

    signals.push({
      signalId: `profile_summary_${date}`,
      source: 'profile',
      kind: 'profile_completeness',
      recordedAt: day,
      userId,
      triggerType: TriggerType.TIMER,
      payload: {
        activeAllergyCount,
        activeConditionCount: activeConditions,
        missingFields,
        isComplete: missingFields.length === 0,
      },
    });

    return signals;
  }
}
