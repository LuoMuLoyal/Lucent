import { Injectable } from '@nestjs/common';
import { DailyRecordKind } from '#generated/prisma/client';
import { DailyRecordReaderPort } from '../../../daily-records';
import {
  HealthEventsOwnershipService,
  type HealthEventRecord,
} from '../../../health-events';

import type { SuggestionSignal } from '../../types/signal.types';
import { TriggerType } from '../../types/suggestion.types';
import { now, parseDateOnly } from '../../../../common';

/**
 * Collects health-event signals for the today-suggestion engine.
 *
 * Exposes the active event's check-in sequence and the count of symptom records
 * recorded during the event window. Consumers (rules) decide whether the trend
 * warrants an escalation notification.
 */
@Injectable()
export class HealthEventCollectorService {
  constructor(
    private readonly healthEvents: HealthEventsOwnershipService,
    private readonly dailyRecordReader: DailyRecordReaderPort,
  ) {}

  async collect(userId: string, date: string): Promise<SuggestionSignal[]> {
    const event = await this.healthEvents.findActive(userId);
    if (event == null) {
      return [];
    }

    const [checkIns, symptomRecordCount] = await Promise.all([
      this.healthEvents.findCheckIns(userId, event.id),
      this.countSymptomRecords(userId, event),
    ]);

    const day = parseDateOnly(date);

    return [
      {
        signalId: `he_event_check_in_trend_${date}`,
        source: 'health_event',
        kind: 'event_check_in_trend',
        recordedAt: day,
        userId,
        triggerType: TriggerType.EVENT,
        payload: {
          eventId: event.id,
          eventTitle: event.title,
          startedAt: event.startedAt.toISOString(),
          endedAt: event.endedAt?.toISOString() ?? null,
          checkIns: checkIns.map((checkIn) => ({
            date: this.toDateOnly(checkIn.date),
            outcome: checkIn.outcome,
          })),
          symptomRecordCount,
        },
      },
    ];
  }

  private countSymptomRecords(
    userId: string,
    event: HealthEventRecord,
  ): Promise<number> {
    const from = event.startedAt;
    const to = event.endedAt ?? now();
    return this.dailyRecordReader.countFactsInRange(userId, from, to, [
      DailyRecordKind.symptom,
    ]);
  }

  private toDateOnly(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
