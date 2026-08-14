import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma';
import { ProductEventsModule } from '../product-events/product-events.module';
import { HealthEventsController } from './health-events.controller';
import { CheckInsService } from './services/check-ins.service';
import { EventsService } from './services/events.service';
import { HealthEventsOwnershipService } from './services/ownership.service';
import { HealthEventRepositoryPort } from './repositories/event.repository';
import { PrismaEventRepository } from './repositories/prisma-event.repository';

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
