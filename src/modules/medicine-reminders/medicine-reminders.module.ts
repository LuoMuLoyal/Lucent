import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { MedicineRemindersController } from './medicine-reminders.controller';
import { MedicineRemindersOwnershipService } from './services';
import { MedicineRemindersMapperService } from './services';
import { MedicineRemindersService } from './services';
import { ReminderSchedulerService } from './services';
import { ReminderDeliveriesController } from './reminder-deliveries.controller';
import {
  MedicineReminderRepositoryPort,
  MedicineReminderRepository,
} from './repositories';

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
