import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/index.js';
import { DomainEventPublisher } from './domain-event-publisher.service.js';
import {
  DomainEventFanOutService,
  EventConsumerRegistry,
} from './domain-events-fanout.service.js';
import { DomainEventOutboxService } from './domain-events-outbox.service.js';

/**
 * Outbox glue for cross-context domain events (ADR-0025).
 *
 * Producers call `DomainEventPublisher`, which appends to the outbox and
 * (during the migration) also emits in process; the outbox poller claims rows
 * and `DomainEventFanOutService` turns each one into the jobs listed in
 * `subscriptions.ts`. Module-owned queue services register their inline
 * handler in `EventConsumerRegistry` for the no-Redis case, so `common/` still
 * has no import of any business module.
 *
 * `BullmqModule` is global, so the fan-out service resolves
 * `BullmqQueueFactory` without an explicit import here.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    DomainEventOutboxService,
    DomainEventFanOutService,
    EventConsumerRegistry,
    DomainEventPublisher,
  ],
  exports: [
    DomainEventOutboxService,
    DomainEventFanOutService,
    EventConsumerRegistry,
    DomainEventPublisher,
  ],
})
export class DomainEventsModule {}
