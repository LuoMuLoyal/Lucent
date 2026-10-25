/**
 * Event adapter: `SettingsEvents` via the shared `DomainEventPublisher`.
 *
 * Publishes `settings.changed` (payload `{ userId }`). The publish is awaited
 * but **never** fails the request: `reports` / `today-suggestion` only use the
 * event to drop derived cache entries, and the setting itself is already
 * persisted by the time this runs. The failure is logged so a broker outage
 * stays observable (ADR-0012 `no-silent-catch`).
 */

import { Injectable, Logger } from '@nestjs/common';

import { DomainEventPublisher } from '../../../../common/index.js';
import { fromPromise } from '../../../../common/result/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import {
  SETTINGS_CHANGED,
  type SettingsChangedPayload,
} from '../../../../common/events/domain-events.js';
import { SettingsEvents } from '../../application/ports/settings-events.js';

@Injectable()
export class PublishedSettingsEvents extends SettingsEvents {
  private readonly logger = new Logger(PublishedSettingsEvents.name);

  constructor(private readonly publisher: DomainEventPublisher) {
    super();
  }

  settingsChanged(userId: string): ResultAsync<void, DomainFailure> {
    return fromPromise(this.publish(userId), (error) => {
      // Publish failures are swallowed inside `publish`; rethrows here would be
      // infrastructure errors, which must not be masked as domain failures.
      throw error;
    });
  }

  private async publish(userId: string): Promise<void> {
    try {
      await this.publisher.publish(SETTINGS_CHANGED, {
        userId,
      } satisfies SettingsChangedPayload);
    } catch (error) {
      this.logger.warn('Failed to publish settings.changed event', {
        userId,
        error,
      });
    }
  }
}
