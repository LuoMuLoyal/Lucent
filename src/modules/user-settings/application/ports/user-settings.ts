/**
 * Port for reading and updating user settings.
 *
 * Consumed by modules that need settings (`today-suggestion`, `reports`,
 * `assistant`) without depending on this module's use cases, read model or
 * cache internals — the whole point of the port is that its implementation can
 * move between layers without touching the consumers.
 *
 * Registered in `UserSettingsModule` via
 * `{ provide: IUserSettingsPort, useExisting: UserSettingsService }`.
 *
 * ## Why the signatures use the HTTP DTO types
 *
 * They are the shapes cross-context consumers (`today-suggestion`, `reports`,
 * `assistant`) already depend on, and those modules are owned by other tracks.
 * The forward edge into `adapters/http/dto` is therefore a declared exception in
 * `.dependency-cruiser.cjs`, not an oversight.
 */

import type { UserSettingsDataDto } from '../../adapters/http/dto/response.js';
import type { UpdateUserSettingsDto } from '../../adapters/http/dto/update.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';

export abstract class IUserSettingsPort {
  abstract getSettings(userId: string): Promise<UserSettingsDataDto>;

  abstract updateSettings(
    userId: string,
    dto: UpdateUserSettingsDto,
  ): ResultAsync<UserSettingsDataDto, DomainFailure>;
}
