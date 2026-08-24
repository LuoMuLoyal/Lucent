import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { UserSettingsController } from './user-settings.controller';
import { UserSettingsService } from './services/user-settings.service';

@Module({
  imports: [AuthModule],
  controllers: [UserSettingsController],
  providers: [UserSettingsService],
  exports: [UserSettingsService],
})
export class UserSettingsModule {}
