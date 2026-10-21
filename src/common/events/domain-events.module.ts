import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/index.js';
import { DomainEventOutboxService } from './domain-events-outbox.service.js';

/**
 * Outbox glue for cross-context domain events (ADR-0024). The global
 * `EventEmitterModule` (registered in `app.module.ts`) already provides the
 * `EventEmitter2` instance; this module adds Prisma access and exports the
 * append/publish service. Modules append synchronously inside their write
 * transaction, the publisher drains and re-dispatches.
 */
@Module({
  imports: [PrismaModule],
  providers: [DomainEventOutboxService],
  exports: [DomainEventOutboxService],
})
export class DomainEventsModule {}
