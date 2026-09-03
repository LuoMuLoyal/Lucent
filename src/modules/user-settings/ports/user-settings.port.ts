import type { UserSettingsDataDto } from '../dto/response.dto.js';
import type { UpdateUserSettingsDto } from '../dto/update.dto.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../common/result/index.js';

/**
 * Port for reading and updating user settings.  Consumed by modules that
 * need to access user settings (today-suggestion, reports, assistant)
 * without depending on the full UserSettingsService class (which also
 * includes cache invalidation internals and event emission details).
 *
 * Registered in UserSettingsModule via:
 * `{ provide: IUserSettingsPort, useExisting: UserSettingsService }`
 */
export abstract class IUserSettingsPort {
  abstract getSettings(userId: string): Promise<UserSettingsDataDto>;

  abstract updateSettings(
    userId: string,
    dto: UpdateUserSettingsDto,
  ): ResultAsync<UserSettingsDataDto, DomainFailure>;
}
