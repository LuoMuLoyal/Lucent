import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma';
import { AdminGuard } from './guards/admin.guard';
import { ProductEventsController } from './product-events.controller';
import { ProductEventsService } from './services/events.service';
import { ProductFunnelService } from './services/funnel.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProductEventsController],
  providers: [ProductEventsService, ProductFunnelService, AdminGuard],
  exports: [ProductEventsService],
})
export class ProductEventsModule {}
