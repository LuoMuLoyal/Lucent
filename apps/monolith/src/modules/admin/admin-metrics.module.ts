import { Module } from '@nestjs/common';
import { AdminModule } from './admin.module.js';
import { ProductModule } from './../product/product.module.js';
import { AdminMetricsController } from './metrics.controller.js';

/**
 * Admin-owned metrics surface that reads from another module's service.
 *
 * `AdminModule` cannot host {@link AdminMetricsController}: `ProductModule`
 * already imports `AdminModule` (its controller guards with `AdminGuard`), so
 * the reverse edge would be a module cycle. This module takes the read
 * dependency on `product` and the guard dependency on `AdminModule`
 * without ever being imported back by either — the graph stays acyclic.
 */
@Module({
  imports: [AdminModule, ProductModule],
  controllers: [AdminMetricsController],
})
export class AdminMetricsModule {}
