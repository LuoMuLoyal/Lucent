/**
 * Use case: `PATCH /api/v1/user/settings`.
 *
 * Write → invalidate → announce → re-read. The order matters:
 *
 * 1. **Write** the field→row upserts (one call, one statement per key).
 * 2. **Invalidate** the cache *before* publishing, so a consumer that reacts to
 *    the event by re-reading this context cannot hit the stale entry.
 * 3. **Announce** `settings.changed` — best effort; a dropped event degrades
 *    derived state but does not undo a persisted setting.
 * 4. **Re-read** through the read model so the response is exactly what a
 *    subsequent `GET` returns (including a freshly assembled `updatedAt`).
 *
 * An empty patch short-circuits to a plain read: `PATCH {}` must not write, not
 * invalidate and not publish.
 */

import {
  DomainFailureException,
  fromPromise,
  isDomainFailure,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import {
  UserSettings,
  type UserSettingsPatch,
} from '../../domain/settings/user-settings.js';
import type { SettingsRepository } from '../../domain/settings/settings.js';
import type { SettingsCache } from '../ports/settings-cache.js';
import type { SettingsEvents } from '../ports/settings-events.js';
import type {
  UserSettingsReadModel,
  UserSettingsView,
} from '../read_models/user-settings.js';

export class UpdateUserSettings {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly cache: SettingsCache,
    private readonly events: SettingsEvents,
    private readonly readModel: UserSettingsReadModel,
  ) {}

  execute(
    userId: string,
    patch: UserSettingsPatch,
  ): ResultAsync<UserSettingsView, DomainFailure> {
    const upserts = UserSettings.upsertsFor(patch);
    if (upserts.length === 0) {
      return fromPromise(this.readModel.get(userId), (error) => {
        throw error;
      });
    }

    return fromPromise(this.repository.upsertMany(userId, upserts), (error) => {
      // A rejected write is either a mapped domain outcome (409 on a unique
      // race, say) or real infrastructure breakage. The Prisma adapter rejects
      // mapped errors as `DomainFailureException`; unwrap those into the Result
      // channel and rethrow everything else, so a connection loss never
      // reaches the client as a 4xx.
      if (error instanceof DomainFailureException) {
        return error.failure;
      }
      if (isDomainFailure(error)) {
        return error;
      }
      throw error;
    })
      .andThen(() =>
        fromPromise(this.cache.invalidate(userId), (error) => {
          throw error;
        }),
      )
      .andThen(() => this.events.settingsChanged(userId))
      .andThen(() =>
        fromPromise(this.readModel.get(userId), (error) => {
          throw error;
        }),
      );
  }
}
