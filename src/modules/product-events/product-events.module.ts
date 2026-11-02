import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/index.js';
import { AdminModule } from '../admin/admin.module.js';
import { ProductEventsController } from './adapters/http/product-events.controller.js';
import { ProductEventsService } from './application/use_cases/events.js';
import { ProductFunnelService } from './application/use_cases/funnel.js';
import { ProductEvents } from './application/ports/product-events.js';
import { PrismaProductEvents } from './infrastructure/persistence/product-events.js';

@Module({
  imports: [PrismaModule, AdminModule],
  controllers: [ProductEventsController],
  providers: [
    PrismaProductEvents,
    { provide: ProductEvents, useExisting: PrismaProductEvents },
    ProductEventsService,
    ProductFunnelService,
  ],
  exports: [ProductEventsService, ProductFunnelService],
})
export class ProductEventsModule {}
