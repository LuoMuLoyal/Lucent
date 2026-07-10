import { Module } from '@nestjs/common';
import { MedicineRemindersController } from './medicine-reminders.controller';
import { MedicineRemindersOwnershipService } from './services/ownership.service';
import { MedicineRemindersMapperService } from './services/mapper.service';
import { MedicineRemindersService } from './services/reminders.service';
import { ReminderDeliveriesController } from './reminder-deliveries.controller';
import {
  MedicineReminderRepositoryPort,
  MedicineReminderRepository,
} from './repositories';

@Module({
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
  ],
  exports: [MedicineRemindersService],
})
export class MedicineRemindersModule {}
