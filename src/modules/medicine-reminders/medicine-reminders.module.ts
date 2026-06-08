import { Module } from '@nestjs/common';
import { MedicineRemindersController } from './medicine-reminders.controller';
import { MedicineRemindersService } from './medicine-reminders.service';

@Module({
  controllers: [MedicineRemindersController],
  providers: [MedicineRemindersService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class MedicineRemindersModule {}
