import { Injectable } from '@nestjs/common';

import { fromPromise } from '../../../../common/result/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import type { UserSettingsPatch } from '../../domain/settings/user-settings.js';
import { IUserSettingsPort } from '../ports/user-settings.js';
import type { UserSettingsResource } from '../ports/user-settings-resource.js';
import type { UpdateUserSettingsCommand } from '../ports/user-settings-resource.js';
import type { UserSettingsReadModel } from '../read_models/user-settings.js';
import type { UpdateUserSettings } from '../use_cases/update-settings.js';

/**
 * Application facade over this context's read model and use cases.
 *
 * ## Why the facade exists
 *
 * Two entry points need the same two operations: the HTTP adapter (the
 * controller) and the cross-context reader port (`IUserSettingsPort`, consumed
 * by `today-suggestion` / `reports` / `assistant`). The wiring lives here once
 * instead of twice, and the port never reaches into a use case or read model.
 *
 * ## Types come from `application/ports/`
 *
 * `UserSettingsResource` / `UpdateUserSettingsCommand` are application-owned.
 * The HTTP DTOs are pinned to them, not the other way round (D2).
 */
@Injectable()
export class UserSettingsService extends IUserSettingsPort {
  constructor(
    private readonly readModel: UserSettingsReadModel,
    private readonly updateSettingsUseCase: UpdateUserSettings,
  ) {
    super();
  }

  getSettings(userId: string): Promise<UserSettingsResource> {
    return this.readModel.get(userId);
  }

  updateSettings(
    userId: string,
    dto: UpdateUserSettingsCommand,
  ): ResultAsync<UserSettingsResource, DomainFailure> {
    const patch = toPatch(dto);
    // An empty patch must not write, invalidate or publish. The use case
    // short-circuits on an empty upsert list anyway; returning here keeps the
    // guarantee visible at the facade.
    if (Object.values(patch).every((value) => value === undefined)) {
      return fromPromise(this.readModel.get(userId), (error) => {
        throw error;
      });
    }
    return this.updateSettingsUseCase.execute(userId, patch);
  }

  /** Drops the cached resource after an out-of-band write. */
  invalidateUserCache(userId: string): Promise<void> {
    return this.readModel.invalidate(userId);
  }
}

/**
 * Widens the update command into the domain patch.
 *
 * The two shapes are structurally identical today; the copy exists so a future
 * rename on either side cannot silently change the other.
 */
function toPatch(dto: UpdateUserSettingsCommand): UserSettingsPatch {
  const patch: UserSettingsPatch = {};
  if (dto.aiSummariesEnabled !== undefined) {
    patch.aiSummariesEnabled = dto.aiSummariesEnabled;
  }
  if (dto.dataSharingConsent !== undefined) {
    patch.dataSharingConsent = dto.dataSharingConsent;
  }
  if (dto.assistantEnabled !== undefined) {
    patch.assistantEnabled = dto.assistantEnabled;
  }
  if (dto.assistantMemoryEnabled !== undefined) {
    patch.assistantMemoryEnabled = dto.assistantMemoryEnabled;
  }
  if (dto.waterTargetCount !== undefined) {
    patch.waterTargetCount = dto.waterTargetCount;
  }
  if (dto.assistantContext !== undefined) {
    // `exactOptionalPropertyTypes` is on: an explicit `undefined` is not the
    // same as an absent key, and "absent" is the domain's no-op signal.
    const context: NonNullable<UserSettingsPatch['assistantContext']> = {};
    for (const [field, value] of Object.entries(dto.assistantContext) as Array<
      [keyof NonNullable<UserSettingsPatch['assistantContext']>, boolean]
    >) {
      context[field] = value;
    }
    patch.assistantContext = context;
  }
  return patch;
}
