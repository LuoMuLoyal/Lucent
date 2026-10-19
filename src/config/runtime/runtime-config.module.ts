/**
 * Registers the runtime-config snapshot service globally.
 *
 * The source provider is the only network-aware piece: the factory returns the
 * rnacos adapter when `RNACOS_ENABLED=true` and `null` otherwise, so a disabled
 * configuration center costs nothing — no connection attempt, and no native
 * module loaded (the adapter imports the binding lazily).
 */

import { Global, Module } from '@nestjs/common';
import { createRuntimeConfigDocumentSource } from './runtime-config-source.factory.js';
import { RUNTIME_CONFIG_SOURCE } from './runtime-config-source.js';
import { RuntimeConfigService } from './runtime-config.service.js';

@Global()
@Module({
  providers: [
    RuntimeConfigService,
    {
      provide: RUNTIME_CONFIG_SOURCE,
      useFactory: createRuntimeConfigDocumentSource,
    },
  ],
  exports: [RuntimeConfigService],
})
export class RuntimeConfigModule {}
