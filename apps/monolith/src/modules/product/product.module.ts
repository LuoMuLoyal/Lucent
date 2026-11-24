import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/index.js';
import { AdminModule } from '../admin/admin.module.js';
import { ProductController } from './adapters/http/product.controller.js';
import { ProductEventLogService } from './application/use_cases/events.js';
import { ProductFunnelService } from './application/use_cases/funnel.js';
import { ProductEventLog } from './application/ports/product-event.js';
import { PrismaProductEventLog } from './infrastructure/persistence/product-event.js';

@Module({
  imports: [PrismaModule, AdminModule],
  controllers: [ProductController],
  providers: [
    PrismaProductEventLog,
    { provide: ProductEventLog, useExisting: PrismaProductEventLog },
    ProductEventLogService,
    ProductFunnelService,
  ],
  exports: [ProductEventLogService, ProductFunnelService],
})
export class ProductModule {}
