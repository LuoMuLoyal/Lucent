import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ReminderController } from './adapters/http/reminder.controller.js';
import { ReminderDeliveriesController } from './adapters/http/reminder-deliveries.controller.js';
import { ReminderDispatchQueue } from './adapters/queue/dispatch.js';
import { REMINDER_DISPATCH_SCHEDULER } from './application/ports/reminder-dispatch-scheduler.js';
import { RemindersOwnership } from './application/use_cases/ownership.js';
import { RemindersMapper } from './application/read_models/mapper.js';
import { RemindersService } from './application/services/reminders.js';
import { ReminderSchedulerService } from './infrastructure/messaging/scheduler.js';
import { DeliveryReceiptsService } from './infrastructure/persistence/delivery-receipts.js';
import {
  ReminderDeliveries,
  ReminderDispatcher,
} from './application/ports/delivery-services.js';
import {
  ReminderEntryReaderPort,
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
  controllers: [ReminderController, ReminderDeliveriesController],
  providers: [
    PrismaReminders,
    { provide: ReminderRepositoryPort, useExisting: PrismaReminders },
    { provide: ReminderEntryReaderPort, useExisting: PrismaReminders },
    RemindersOwnership,
    RemindersMapper,
    RemindersService,
    ReminderSchedulerService,
    { provide: ReminderDispatcher, useExisting: ReminderSchedulerService },

    ReminderDispatchQueue,
    {
      provide: REMINDER_DISPATCH_SCHEDULER,
      useExisting: ReminderDispatchQueue,
    },
    DeliveryReceiptsService,
    { provide: ReminderDeliveries, useExisting: DeliveryReceiptsService },
  ],
  exports: [
    RemindersService,
    ReminderSchedulerService,
    ReminderEntryReaderPort,
  ],
})
export class ReminderModule {}
