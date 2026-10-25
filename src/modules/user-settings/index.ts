export type { AssistantContextSettingsDto } from './adapters/http/dto/response.js';
export type {
  UserSettingsDataDto,
  UserSettingsResponseDto,
} from './adapters/http/dto/response.js';
export type { UpdateUserSettingsDto } from './adapters/http/dto/update.js';
/**
 * Domain vocabulary re-exported through the barrel.
 *
 * `USER_SETTING_KEYS` / `USER_SETTINGS_DEFAULTS` /
 * `listDefaultBooleanUserSettings` were already public API before the four-layer
 * migration (other modules and tests build settings rows from them); they now
 * live in `domain/settings/` but the import path stays the barrel.
 * `ASSISTANT_CONTEXT_SETTING_KEYS` / `ASSISTANT_CONTEXT_DEFAULTS` stay private —
 * cross-module readers must go through `IUserSettingsPort.getSettings()`.
 */
export {
  USER_SETTING_KEYS,
  USER_SETTINGS_DEFAULTS,
  listDefaultBooleanUserSettings,
} from './domain/settings/setting-key.js';
export { IUserSettingsPort } from './application/ports/user-settings.js';
export { UserSettingsService } from './application/services/user-settings.js';
export { userSettingsCacheKey } from './infrastructure/cache/settings.js';
