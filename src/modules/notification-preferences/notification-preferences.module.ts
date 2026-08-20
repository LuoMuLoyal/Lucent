import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsModule } from '../reports/reports.module';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesService } from './services/notification-preferences.service';
import { WeeklyInsightSchedulerService } from './services/weekly-insight-scheduler.service';

@Module({
  imports: [PrismaModule, NotificationsModule, ReportsModule],
  controllers: [NotificationPreferencesController],
  providers: [NotificationPreferencesService, WeeklyInsightSchedulerService],
  exports: [NotificationPreferencesService, WeeklyInsightSchedulerService],
})
export class NotificationPreferencesModule {}
