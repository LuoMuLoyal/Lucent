import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { UserSettingsController } from './user-settings.controller';
import { UserSettingsService } from './services/user-settings.service';
import { IUserSettingsPort } from './ports/user-settings.port';

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
