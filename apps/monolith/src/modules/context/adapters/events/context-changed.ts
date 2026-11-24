/**
 * Event adapter: publishes `context.changed` via the shared publisher.
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
  type ContextChangedPayload,
} from '../../../../common/events/domain-events.js';
import { ContextEvents } from '../../application/ports/context-events.js';

@Injectable()
export class PublishedContextEvents extends ContextEvents {
  private readonly logger = new Logger(PublishedContextEvents.name);

  constructor(private readonly publisher: DomainEventPublisher) {
    super();
  }

  contextChanged(userId: string): ResultAsync<void, DomainFailure> {
    return fromPromise(this.publish(userId), (error) => {
      throw error;
    });
  }

  private async publish(userId: string): Promise<void> {
    try {
      await this.publisher.publish(HEALTH_CONTEXT_CHANGED, {
        userId,
      } satisfies ContextChangedPayload);
    } catch (error) {
      this.logger.warn(
        { userId, error },
        'Failed to publish context.changed event',
      );
    }
  }
}
