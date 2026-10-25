import { Injectable } from '@nestjs/common';
import { unwrapResult } from '../../../../../common/result/index.js';
import { parseDateOnly } from '../../../../../common/index.js';
import { IUserHealthContextReader } from '../../../../user-health-context/index.js';
import type { SuggestionSignal } from '../../../domain/signal/signal.js';
import { TriggerType } from '../../../domain/suggestion/suggestion.types.js';

/**
 * Collects health-profile signals: allergies, conditions,
 * and profile completeness for coverage rules.
 *
 * Reads through `IUserHealthContextReader` — the User Profile context's own
 * reader port — instead of querying `user_allergies` / `user_conditions` /
 * `user_profiles` directly. Direct table reads are what ADR-0024 §3 forbids:
 * they couple this context to another context's schema, so a column rename
 * over there silently changes what "profile completeness" means here.
 */
@Injectable()
export class ProfileCollectorService {
  constructor(private readonly healthContext: IUserHealthContextReader) {}

  async collect(userId: string, date: string): Promise<SuggestionSignal[]> {
    const day = parseDateOnly(date);

    const context = await unwrapResult(this.healthContext.getForUser(userId));

    const activeAllergyCount = context.allergies.filter(
      (allergy) => allergy.isActive,
    ).length;
    const activeConditionCount = context.conditions.filter(
      (condition) => condition.status === 'active',
    ).length;
    const profile = context.profile;

    const signals: SuggestionSignal[] = [];

    // Profile completeness signal. The reader always returns a `profile`
    // object (its fields may be null), so no optional chain is needed.
    const missingFields: string[] = [];
    if (profile.birthDate == null) missingFields.push('birthDate');
    if (profile.sexAtBirth == null) missingFields.push('sexAtBirth');
    if (profile.heightCm == null) missingFields.push('heightCm');

    signals.push({
      signalId: `profile_summary_${date}`,
      source: 'profile',
      kind: 'profile_completeness',
      recordedAt: day,
      userId,
      triggerType: TriggerType.TIMER,
      payload: {
        activeAllergyCount,
        activeConditionCount,
        missingFields,
        isComplete: missingFields.length === 0,
      },
    });

    return signals;
  }
}
