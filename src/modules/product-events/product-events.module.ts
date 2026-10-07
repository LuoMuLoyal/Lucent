import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/index.js';
import { AdminModule } from '../admin/admin.module.js';
import { ProductEventsController } from './product-events.controller.js';
import { ProductEventsService } from './services/events.service.js';
import { ProductFunnelService } from './services/funnel.service.js';

@Module({
  imports: [PrismaModule, AdminModule],
  controllers: [ProductEventsController],
  providers: [ProductEventsService, ProductFunnelService],
  exports: [ProductEventsService],
})
export class ProductEventsModule {}
