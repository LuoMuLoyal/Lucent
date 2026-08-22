import { Global, Module } from '@nestjs/common';
import { ProblemCatalog } from '../problem-catalog';
import { SseConnectionRegistry } from './sse-connection-registry.service';
import { SseProblemDetailsMapper } from './sse-problem-details';

/**
 * Global module exposing the SSE connection registry as a single shared
 * instance: any controller can register its streams, and the shutdown
 * lifecycle hook closes them all from that same instance.
 */
@Global()
@Module({
  providers: [ProblemCatalog, SseProblemDetailsMapper, SseConnectionRegistry],
  exports: [ProblemCatalog, SseProblemDetailsMapper, SseConnectionRegistry],
})
export class SseModule {}
