import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { MedicineRemindersController } from './medicine-reminders.controller';
import { MedicineRemindersOwnershipService } from './services/ownership.service';
import { MedicineRemindersMapperService } from './services/mapper.service';
import { MedicineRemindersService } from './services/reminders.service';
import { ReminderSchedulerService } from './services/scheduler.service';
import { ReminderDeliveriesController } from './reminder-deliveries.controller';
import {
  MedicineReminderRepositoryPort,
  MedicineReminderRepository,
} from './repositories/reminder.repository';

@Module({
  imports: [NotificationsModule],
  controllers: [MedicineRemindersController, ReminderDeliveriesController],
  providers: [
    MedicineReminderRepository,
    {
      provide: MedicineReminderRepositoryPort,
      useExisting: MedicineReminderRepository,
    },
    MedicineRemindersOwnershipService,
    MedicineRemindersMapperService,
    MedicineRemindersService,
    ReminderSchedulerService,
  ],
  exports: [MedicineRemindersService],
})
export class MedicineRemindersModule {}
