import { Module } from '@nestjs/common';
import { MedicineRemindersController } from './medicine-reminders.controller';
import { MedicineRemindersGuardService } from './guards/medicine-reminders-guard.service';
import { MedicineRemindersMapperService } from './services/medicine-reminders-mapper.service';
import { MedicineRemindersService } from './medicine-reminders.service';
import { ReminderDeliveriesController } from './reminder-deliveries.controller';

@Module({
  controllers: [MedicineRemindersController, ReminderDeliveriesController],
  providers: [
    MedicineRemindersGuardService,
    MedicineRemindersMapperService,
    MedicineRemindersService,
  ],
  exports: [MedicineRemindersService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class MedicineRemindersModule {}
