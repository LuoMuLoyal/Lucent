import { Module } from '@nestjs/common';
import { MedicineRemindersController } from './medicine-reminders.controller';
import { MedicineRemindersOwnershipService } from './services/ownership.service';
import { MedicineRemindersMapperService } from './services/mapper.service';
import { MedicineRemindersService } from './services/reminders.service';
import { ReminderDeliveriesController } from './reminder-deliveries.controller';

@Module({
  controllers: [MedicineRemindersController, ReminderDeliveriesController],
  providers: [
    MedicineRemindersOwnershipService,
    MedicineRemindersMapperService,
    MedicineRemindersService,
  ],
  exports: [MedicineRemindersService],
})
export class MedicineRemindersModule {}
