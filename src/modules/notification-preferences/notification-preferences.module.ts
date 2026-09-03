import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/index.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { NotificationPreferencesController } from './notification-preferences.controller.js';
import { NotificationPreferencesService } from './services/notification-preferences.service.js';
import { WeeklyInsightSchedulerService } from './services/weekly-insight-scheduler.service.js';

@Module({
  imports: [PrismaModule, NotificationsModule, ReportsModule],
  controllers: [NotificationPreferencesController],
  providers: [NotificationPreferencesService, WeeklyInsightSchedulerService],
  exports: [NotificationPreferencesService, WeeklyInsightSchedulerService],
})
export class NotificationPreferencesModule {}
