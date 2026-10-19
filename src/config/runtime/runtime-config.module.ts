/**
 * Registers the runtime-config snapshot service globally.
 *
 * Task 1 is local-only: nothing here talks to a configuration center. The
 * optional `RuntimeConfigSource` adapter (rnacos) is added by a later task and
 * only runs when `RNACOS_ENABLED=true`.
 */

import { Global, Module } from '@nestjs/common';
import { RuntimeConfigService } from './runtime-config.service.js';

@Global()
@Module({
  providers: [RuntimeConfigService],
  exports: [RuntimeConfigService],
})
export class RuntimeConfigModule {}
