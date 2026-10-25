/**
 * Event adapter: publishes `dose-log.changed` through the shared publisher.
 *
 * Best effort by design: the log is already persisted when this runs, and a
 * dropped event only means a derived suggestion goes stale until its next
 * recompute. The failure is logged so a broker outage stays observable
 * (`error-handling/no-silent-catch`).
 */

import { Injectable, Logger } from '@nestjs/common';

import { DomainEventPublisher } from '../../../../common/index.js';
import { fromPromise } from '../../../../common/result/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import {
  DOSE_LOG_CHANGED,
  type DoseLogChangedPayload,
} from '../../../../common/events/domain-events.js';
import { DoseLogEvents } from '../../application/ports/dose-log-events.js';

@Injectable()
export class PublishedDoseLogEvents extends DoseLogEvents {
  private readonly logger = new Logger(PublishedDoseLogEvents.name);

  constructor(private readonly publisher: DomainEventPublisher) {
    super();
  }

  doseLogChanged(input: {
    userId: string;
    date: string;
    doseLogId?: string;
  }): ResultAsync<void, DomainFailure> {
    return fromPromise(this.publish(input), (error) => {
      throw error;
    });
  }

  private async publish(input: {
    userId: string;
    date: string;
    doseLogId?: string;
  }): Promise<void> {
    try {
      await this.publisher.publish(DOSE_LOG_CHANGED, {
        userId: input.userId,
        date: input.date,
        ...(input.doseLogId != null ? { doseLogId: input.doseLogId } : {}),
      } satisfies DoseLogChangedPayload);
    } catch (error) {
      this.logger.warn('Failed to publish dose-log.changed event', {
        userId: input.userId,
        error,
      });
    }
  }
}
