import { Injectable, Logger } from '@nestjs/common';

import { DomainEventPublisher } from '../../../../common/index.js';
import { DAILY_RECORD_CHANGED } from '../../../../common/events/domain-events.js';
import {
  RecordChangeEvents,
  type RecordChangedEvent,
} from '../../application/ports/record-change-events.js';

/**
 * Publishes `daily-record.changed` through the outbox publisher (ADR-0025).
 *
 * The event is a cache-invalidation signal, not a business fact: publishing is
 * best-effort and a failure is logged, never propagated. The write it belongs to
 * has already committed by the time this runs, so failing the request would
 * report a write that actually succeeded as an error.
 */
@Injectable()
export class OutboxRecordChangeEvents extends RecordChangeEvents {
  private readonly logger = new Logger(OutboxRecordChangeEvents.name);

  constructor(private readonly publisher: DomainEventPublisher) {
    super();
  }

  async publish(event: RecordChangedEvent): Promise<void> {
    try {
      await this.publisher.publish(
        DAILY_RECORD_CHANGED,
        {
          userId: event.userId,
          date: event.date,
          ...(event.kind != null ? { kind: event.kind } : {}),
          ...(event.recordId != null ? { recordId: event.recordId } : {}),
        },
        `daily-record.changed:${event.recordId ?? `${event.userId}:${event.date}`}`,
      );
    } catch (error) {
      this.logger.warn('Failed to publish daily-record.changed event', {
        userId: event.userId,
        error,
      });
    }
  }
}
