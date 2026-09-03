import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/index.js';
import { AdminGuard } from './guards/admin.guard.js';
import { ProductEventsController } from './product-events.controller.js';
import { ProductEventsService } from './services/events.service.js';
import { ProductFunnelService } from './services/funnel.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [ProductEventsController],
  providers: [ProductEventsService, ProductFunnelService, AdminGuard],
  exports: [ProductEventsService],
})
export class ProductEventsModule {}
