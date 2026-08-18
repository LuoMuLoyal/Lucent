import { Injectable } from '@nestjs/common';
import type {
  EventReviewEventDto,
  EventReviewSectionDto,
} from '../../dto/event-review-response.dto';

/** Window facts the whatHappened section needs beyond the event identity. */
export interface ReviewEventFactInput {
  event: EventReviewEventDto;
  /** Count of symptom daily records inside the event window (exact query). */
  symptomRecordCount: number;
  /** Count of user-confirmed check-ins for the event. */
  checkInCount: number;
  /**
   * Title of the daily record that triggered the event (from
   * `HealthEventRecord.reasonRecordId`), or null when the event has no
   * trigger record or the record could not be resolved.
   */
  reasonRecordTitle: string | null;
}

/**
 * WhatHappened section builder.
 *
 * Reports the event identity (kind/title/window), the medicines linked to
 * the event and the observed symptom/check-in counts. It never emits
 * free-text notes — Luminous localizes the structured arguments.
 */
@Injectable()
export class EventReviewFactsService {
  build(input: ReviewEventFactInput): EventReviewSectionDto {
    const event = input.event;
    return {
      state: 'available',
      facts: {
        code: 'health_event',
        arguments: {
          kind: event.kind,
          title: event.title,
          startedAt: event.startedAt,
          endedAt: event.endedAt,
          medicineIds: [...event.currentMedicineIds],
          symptomRecordCount: input.symptomRecordCount,
          checkInCount: input.checkInCount,
          reasonRecordTitle: input.reasonRecordTitle,
        },
      },
    };
  }
}
