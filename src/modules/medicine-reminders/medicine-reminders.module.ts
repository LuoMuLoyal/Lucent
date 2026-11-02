import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { MedicineRemindersController } from './adapters/http/medicine-reminders.controller.js';
import { ReminderDeliveriesController } from './adapters/http/reminder-deliveries.controller.js';
import { ReminderDispatchQueue } from './adapters/queue/dispatch.js';
import { MedicineRemindersOwnership } from './application/use_cases/ownership.js';
import { MedicineRemindersMapper } from './application/read_models/mapper.js';
import { MedicineRemindersService } from './application/services/reminders.js';
import { ReminderSchedulerService } from './infrastructure/messaging/scheduler.js';
import { DeliveryReceiptsService } from './infrastructure/persistence/delivery-receipts.js';
import {
  ReminderDeliveries,
  ReminderDispatcher,
} from './application/ports/delivery-services.js';
import {
  MedicineReminderReaderPort,
  ReminderRepositoryPort,
} from './application/ports/reminder-repository.js';
import { PrismaReminders } from './infrastructure/persistence/reminders.js';

/**
 * Medication Tracking context — reminder schedules and delivery audit
 * (ADR-0024).
 *
 * The repeatable `reminder-dispatch` job is registered by this module
 * (`adapters/queue/dispatch.ts`), not by `common/queue`: the queue *name* is
 * shared configuration, but the work it triggers belongs to this context.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [MedicineRemindersController, ReminderDeliveriesController],
  providers: [
    PrismaReminders,
    { provide: ReminderRepositoryPort, useExisting: PrismaReminders },
    { provide: MedicineReminderReaderPort, useExisting: PrismaReminders },
    MedicineRemindersOwnership,
    MedicineRemindersMapper,
    MedicineRemindersService,
    ReminderSchedulerService,
    { provide: ReminderDispatcher, useExisting: ReminderSchedulerService },

    ReminderDispatchQueue,
    DeliveryReceiptsService,
    { provide: ReminderDeliveries, useExisting: DeliveryReceiptsService },
  ],
  exports: [
    MedicineRemindersService,
    ReminderSchedulerService,
    MedicineReminderReaderPort,
  ],
})
export class MedicineRemindersModule {}
