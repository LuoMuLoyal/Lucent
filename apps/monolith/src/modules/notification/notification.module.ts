import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/index.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { NotificationController } from './notification.controller.js';
import { NotificationService } from './services/notification.service.js';
import { WeeklyInsightSchedulerService } from './services/weekly-insight-scheduler.service.js';

@Module({
  imports: [PrismaModule, NotificationsModule, ReportsModule],
  controllers: [NotificationController],
  providers: [NotificationService, WeeklyInsightSchedulerService],
  exports: [NotificationService, WeeklyInsightSchedulerService],
})
export class NotificationModule {}
