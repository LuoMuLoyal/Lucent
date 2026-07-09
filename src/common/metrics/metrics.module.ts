import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';

/**
 * Global module that provides the Prometheus metrics registry and recording
 * service to the entire application.
 *
 * The `/metrics` HTTP endpoint is registered as a raw Express route in
 * `setupApp` (not as a NestJS controller) to bypass the interceptor/filter
 * stack and avoid self-referential metric noise.
 */
@Global()
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
