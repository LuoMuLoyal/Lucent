import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/index.js';
import { ProductEventsModule } from '../product-events/product-events.module.js';
import { HealthEventsController } from './health-events.controller.js';
import { CheckInsService } from './services/check-ins.service.js';
import { EventsService } from './services/events.service.js';
import { HealthEventsOwnershipService } from './services/ownership.service.js';
import { HealthEventRepositoryPort } from './repositories/event.repository.js';
import { PrismaEventRepository } from './repositories/prisma-event.repository.js';

@Module({
  imports: [PrismaModule, ProductEventsModule],
  controllers: [HealthEventsController],
  providers: [
    PrismaEventRepository,
    {
      provide: HealthEventRepositoryPort,
      useExisting: PrismaEventRepository,
    },
    EventsService,
    CheckInsService,
    HealthEventsOwnershipService,
  ],
  exports: [HealthEventsOwnershipService],
})
export class HealthEventsModule {}
