import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesService } from './services/notification-preferences.service';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationPreferencesController],
  providers: [NotificationPreferencesService],
  exports: [NotificationPreferencesService],
})
export class NotificationPreferencesModule {}
