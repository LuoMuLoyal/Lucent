/**
 * Event adapter: publishes `health-context.changed` via the shared publisher.
 *
 * Best effort by design — the write is persisted before this runs, and a failure
 * only means derived suggestions go stale. Logged so a broker outage stays
 * observable (`error-handling/no-silent-catch`).
 */

import { Injectable, Logger } from '@nestjs/common';

import { DomainEventPublisher } from '../../../../common/index.js';
import { fromPromise } from '../../../../common/result/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import {
  HEALTH_CONTEXT_CHANGED,
  type HealthContextChangedPayload,
} from '../../../../common/events/domain-events.js';
import { HealthContextEvents } from '../../application/ports/health-context-events.js';

@Injectable()
export class PublishedHealthContextEvents extends HealthContextEvents {
  private readonly logger = new Logger(PublishedHealthContextEvents.name);

  constructor(private readonly publisher: DomainEventPublisher) {
    super();
  }

  healthContextChanged(userId: string): ResultAsync<void, DomainFailure> {
    return fromPromise(this.publish(userId), (error) => {
      throw error;
    });
  }

  private async publish(userId: string): Promise<void> {
    try {
      await this.publisher.publish(HEALTH_CONTEXT_CHANGED, {
        userId,
      } satisfies HealthContextChangedPayload);
    } catch (error) {
      this.logger.warn('Failed to publish health-context.changed event', {
        userId,
        error,
      });
    }
  }
}
