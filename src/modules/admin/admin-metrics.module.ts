import { Module } from '@nestjs/common';
import { AdminModule } from './admin.module.js';
import { ProductEventsModule } from './../product-events/product-events.module.js';
import { AdminMetricsController } from './metrics.controller.js';

/**
 * Admin-owned metrics surface that reads from another module's service.
 *
 * `AdminModule` cannot host {@link AdminMetricsController}: `ProductEventsModule`
 * already imports `AdminModule` (its controller guards with `AdminGuard`), so
 * the reverse edge would be a module cycle. This module takes the read
 * dependency on `product-events` and the guard dependency on `AdminModule`
 * without ever being imported back by either — the graph stays acyclic.
 */
@Module({
  imports: [AdminModule, ProductEventsModule],
  controllers: [AdminMetricsController],
})
export class AdminMetricsModule {}
