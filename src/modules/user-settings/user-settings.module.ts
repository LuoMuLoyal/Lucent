import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { UserSettingsController } from './user-settings.controller.js';
import { UserSettingsService } from './services/user-settings.service.js';
import { IUserSettingsPort } from './ports/user-settings.port.js';

@Module({
  imports: [AuthModule],
  controllers: [UserSettingsController],
  providers: [
    UserSettingsService,
    { provide: IUserSettingsPort, useExisting: UserSettingsService },
  ],
  exports: [UserSettingsService, IUserSettingsPort],
})
export class UserSettingsModule {}
