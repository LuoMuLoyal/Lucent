import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { MedicineRemindersController } from './medicine-reminders.controller.js';
import { MedicineRemindersOwnershipService } from './services/ownership.service.js';
import { MedicineRemindersMapperService } from './services/mapper.service.js';
import { MedicineRemindersService } from './services/reminders.service.js';
import { ReminderSchedulerService } from './services/scheduler.service.js';
import { DeliveryReceiptsService } from './services/delivery-receipts.service.js';
import { ReminderDeliveriesController } from './reminder-deliveries.controller.js';
import {
  MedicineReminderRepositoryPort,
  MedicineReminderRepository,
  MedicineReminderReaderPort,
} from './repositories/reminder.repository.js';

@Module({
  imports: [NotificationsModule],
  controllers: [MedicineRemindersController, ReminderDeliveriesController],
  providers: [
    MedicineReminderRepository,
    {
      provide: MedicineReminderRepositoryPort,
      useExisting: MedicineReminderRepository,
    },
    {
      provide: MedicineReminderReaderPort,
      useExisting: MedicineReminderRepository,
    },
    MedicineRemindersOwnershipService,
    MedicineRemindersMapperService,
    MedicineRemindersService,
    ReminderSchedulerService,
    DeliveryReceiptsService,
  ],
  exports: [
    MedicineRemindersService,
    ReminderSchedulerService,
    MedicineReminderReaderPort,
  ],
})
export class MedicineRemindersModule {}
