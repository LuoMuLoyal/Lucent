import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/index.js';
import { ProductEventsModule } from '../product-events/product-events.module.js';
import { HealthEventsController } from './adapters/http/health-events.controller.js';
import { CheckInsService } from './application/use_cases/check-ins.js';
import { EventsService } from './application/use_cases/events.js';
import { HealthEventsOwnershipService } from './application/services/ownership.js';
import { HealthEventRepositoryPort } from './application/ports/health-events.js';
import { PrismaHealthEvents } from './infrastructure/persistence/health-events.js';

@Module({
  imports: [PrismaModule, ProductEventsModule],
  controllers: [HealthEventsController],
  providers: [
    PrismaHealthEvents,
    {
      provide: HealthEventRepositoryPort,
      useExisting: PrismaHealthEvents,
    },
    EventsService,
    CheckInsService,
    HealthEventsOwnershipService,
  ],
  exports: [HealthEventsOwnershipService],
})
export class HealthEventsModule {}
