import { Injectable } from '@nestjs/common';
import { HealthEventStatus } from '#generated/prisma/client.js';
import type {
  EventReviewEventDto,
  EventReviewSectionDto,
} from '../../dto/event-review-response.dto.js';

/**
 * Reviewed static red-flag rules only (medication safety module).
 * The union mirrors `MedicineRedFlagRule` — the next-step section never
 * introduces unreviewed rules.
 */
export type ReviewRedFlagRule = 'severeAllergy' | 'informationGap';

export interface ReviewRedFlagInput {
  rule: ReviewRedFlagRule;
  medicineName: string;
  relatedLabel?: string;
}

/** Facts the nextStep section consumes. */
export interface ReviewNextStepInput {
  event: EventReviewEventDto;
  hasTodayCheckIn: boolean;
  /** Static red flags from the reviewed medication risk check, may be empty. */
  redFlags: ReviewRedFlagInput[];
}

/**
 * Runtime allowlist of reviewed static red-flag rules. Rules outside this
 * list (e.g. persisted JSON widened by a future backend version) are
 * dropped at the mapping point, keeping the "reviewed rules only" boundary
 * self-enforcing.
 */
const REVIEWED_RED_FLAG_RULES: readonly string[] = [
  'severeAllergy',
  'informationGap',
];

/**
 * NextStep section builder with fixed rules only — no LLM.
 *
 * - active event without a today check-in → remind the user to confirm;
 * - active event with a today check-in → report the check-in exists;
 * - ended event → show the user-confirmed outcome;
 * - reviewed static safety red flags are attached as structured
 *   rule/medicine data and never as generated copy.
 */
@Injectable()
export class EventReviewNextStepService {
  build(input: ReviewNextStepInput): EventReviewSectionDto {
    const redFlags = input.redFlags
      .filter((flag) => REVIEWED_RED_FLAG_RULES.includes(flag.rule))
      .map((flag) => ({
        rule: flag.rule,
        medicineName: flag.medicineName,
        ...(flag.relatedLabel != null
          ? { relatedLabel: flag.relatedLabel }
          : {}),
      }));

    if (input.event.status === HealthEventStatus.active) {
      return {
        state: 'available',
        facts: {
          code: 'active_check_in',
          arguments: {
            hasTodayCheckIn: input.hasTodayCheckIn,
            ...(redFlags.length > 0 ? { redFlags } : {}),
          },
        },
      };
    }

    return {
      state: 'available',
      facts: {
        code: 'event_ended',
        arguments: {
          outcome: input.event.outcome,
          ...(redFlags.length > 0 ? { redFlags } : {}),
        },
      },
    };
  }
}
