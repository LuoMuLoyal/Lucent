import {
  Inject,
  Injectable,
  Optional,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  getOptionsToken,
  ThrottlerGuard,
  ThrottlerStorage,
  type ThrottlerModuleOptions,
} from '@nestjs/throttler';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../config/runtime/runtime-config.types.js';

const THROTTLER_OPTIONS_TOKEN = getOptionsToken();

/**
 * ThrottlerGuard that re-reads the global window/limit from the runtime-config
 * snapshot before evaluating each request.
 *
 * The values are copied onto the in-memory `default` throttler entry right
 * before `super.canActivate`, which reads them synchronously into its request
 * props. The snapshot reference is stable between publishes, and routes with a
 * `@Throttle(...)` override still win because the guard merges route metadata
 * over the throttler entry. Rebuilding the transform from scratch per request
 * is deliberately avoided (metre: the guard is a singleton).
 */
@Injectable()
export class RuntimeThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(THROTTLER_OPTIONS_TOKEN) options: ThrottlerModuleOptions,
    @Inject(ThrottlerStorage) storageService: ThrottlerStorage,
    reflector: Reflector,
    @Optional()
    @Inject(RuntimeConfigService)
    private readonly runtimeConfig?: RuntimeConfigPort,
  ) {
    super(options, storageService, reflector);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const values = this.runtimeConfig?.getSnapshot().values;
    const ttl = values?.[EnvKey.THROTTLE_TTL_MS];
    const limit = values?.[EnvKey.THROTTLE_LIMIT];

    if (typeof ttl === 'number' && typeof limit === 'number') {
      for (const throttler of this.throttlers) {
        if (throttler.name === 'default') {
          throttler.ttl = ttl;
          throttler.limit = limit;
        }
      }
    }

    return super.canActivate(context);
  }
}
