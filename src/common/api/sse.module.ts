import { Global, Module } from '@nestjs/common';
import { SseConnectionRegistry } from './sse-connection-registry.service';

/**
 * Global module exposing the SSE connection registry as a single shared
 * instance: any controller can register its streams, and the shutdown
 * lifecycle hook closes them all from that same instance.
 */
@Global()
@Module({
  providers: [SseConnectionRegistry],
  exports: [SseConnectionRegistry],
})
export class SseModule {}
