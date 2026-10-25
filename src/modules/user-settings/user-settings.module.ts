import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { UserSettingsController } from './adapters/http/settings.controller.js';
import { PublishedSettingsEvents } from './adapters/events/settings-changed.js';
import { UserSettingsService } from './application/services/user-settings.js';
import { IUserSettingsPort } from './application/ports/user-settings.js';
import { SettingsCache } from './application/ports/settings-cache.js';
import { SettingsEvents } from './application/ports/settings-events.js';
import { UserSettingsReadModel } from './application/read_models/user-settings.js';
import { UpdateUserSettings } from './application/use_cases/update-settings.js';
import { SettingsRepository } from './domain/settings/settings.js';
import { CacheSettings } from './infrastructure/cache/settings.js';
import { PrismaSettings } from './infrastructure/persistence/settings.js';

/**
 * User Profile context — user settings (ADR-0024).
 *
 * Wiring is class-based: `PrismaSettings extends SettingsRepository`,
 * `CacheSettings extends SettingsCache`, `PublishedSettingsEvents extends
 * SettingsEvents`, `UserSettingsService extends IUserSettingsPort`. Nest resolves
 * each abstract class to its concrete provider by token, so no `useExisting`
 * aliases are needed and the application layer never sees an implementation.
 */
@Module({
  imports: [AuthModule],
  controllers: [UserSettingsController],
  providers: [
    PrismaSettings,
    { provide: SettingsRepository, useExisting: PrismaSettings },
    CacheSettings,
    { provide: SettingsCache, useExisting: CacheSettings },
    PublishedSettingsEvents,
    { provide: SettingsEvents, useExisting: PublishedSettingsEvents },
    UserSettingsReadModel,
    UpdateUserSettings,
    UserSettingsService,
    // The port token must be a provider here before it can be exported: Nest
    // rejects exporting a token that this module does not provide.
    { provide: IUserSettingsPort, useExisting: UserSettingsService },
  ],
  exports: [UserSettingsService, IUserSettingsPort],
})
export class UserSettingsModule {}
