/**
 * Application ports for the two collaborators the delivery endpoints and the
 * queue adapter need.
 *
 * ## Why these exist
 *
 * `adapters/**` may not import `infrastructure/**` (ADR-0024 D3): the delivery
 * controller and the queue adapter must talk to an abstraction, not to the class
 * that happens to hold Prisma or a Redis-backed cache today. These abstract
 * classes are that abstraction; the module wires them to the implementations.
 */

import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import type { ReminderDeliveryReceiptDto } from './delivery-receipt.js';
import type { ReminderDeliveryItemDto } from './delivery-resource.js';

/** Persisted delivery-audit row shape returned to the API. */
export interface ReminderDeliveryResource {
  id: string;
  reminderId: string;
  deviceId: string | null;
  channel: string;
  status: string;
  scheduledFor: Date;
  deliveredAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
}

/** One page of delivery rows. */
export interface ReminderDeliveryListResource {
  items: ReminderDeliveryResource[];
}

/** Client-reported local scheduling capability. */
export type LocalCapabilityState = 'active' | 'unavailable' | 'disabled';

/**
 * Cron expression for the dispatch job.
 *
 * Lives on the *port*, not on the scheduler implementation: the queue adapter
 * (which registers the repeatable job) may read the schedule but must not import
 * `infrastructure/`, and the schedule is part of the cross-layer contract exactly
 * like the queue name is.
 */
export const REMINDER_SCHEDULER_CRON = '* * * * *';

/**
 * Delivery endpoints' capabilities.
 *
 * Listing lives on `MedicineRemindersService` (it shares the mapper and the
 * delivery query), while the receipt / capability writes are implemented by the
 * delivery persistence adapter. The controller therefore depends on both ports,
 * never on the classes behind them.
 */
export abstract class ReminderDeliveries {
  /** Idempotent write-back after the client displayed a local notification. */
  abstract recordLocalReceipt(
    userId: string,
    dto: ReminderDeliveryReceiptDto,
  ): ResultAsync<ReminderDeliveryItemDto, DomainFailure>;

  /** Stores the client's local scheduling capability for the push gate. */
  abstract reportLocalCapability(
    userId: string,
    state: LocalCapabilityState,
  ): ResultAsync<{ state: LocalCapabilityState }, DomainFailure>;
}

/** The repeatable reminder-dispatch job trigger. */
export abstract class ReminderDispatcher {
  /** Runs one dispatch pass (every due reminder for every user). */
  abstract dispatchDueReminders(): Promise<void>;
}
