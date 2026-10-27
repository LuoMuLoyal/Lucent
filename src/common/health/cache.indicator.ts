import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import type { Cache } from 'cache-manager';
import { randomUUID } from 'node:crypto';
import { extractErrorInfo } from '../helpers/errors/error-info.utils.js';
import { EnvKey } from '../../config/env/env-keys.enum.js';

/** TTL (ms) for the cache round-trip probe key. */
const PROBE_TTL_MS = 5_000;

/** Cache key prefix for the round-trip probe. */
const HEALTH_PROBE_CACHE_KEY_PREFIX = 'health:probe';

/**
 * Cache (keyv, Redis-backed when `REDIS_URL` is set) health indicator.
 *
 * terminus has no keyv abstraction, so this is a custom indicator that
 * preserves the former `AppService.probeCache()` semantics: without
 * `REDIS_URL` the in-memory fallback is reported `up` (non-critical), and with
 * `REDIS_URL` a `set`/`get`/`del` round-trip is executed and fails the check on
 * any error or unexpected value.
 */
@Injectable()
export class CacheHealthIndicator {
  private readonly logger = new Logger(CacheHealthIndicator.name);

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async ping(options: { verbose: boolean }): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('cache');
    const redisUrl = this.configService.get<string>(EnvKey.REDIS_URL);

    if (!redisUrl) {
      return indicator.up({
        backend: 'memory',
        ...(options.verbose ? { mode: 'fallback' } : {}),
      });
    }

    const startedAt = Date.now();
    const probeKey = `${HEALTH_PROBE_CACHE_KEY_PREFIX}:${randomUUID()}`;
    const probeDetails = options.verbose ? { probe: 'set/get/del' } : {};
    const down = (message: string) =>
      indicator.down({
        message,
        backend: 'redis',
        ...probeDetails,
        durationMs: Date.now() - startedAt,
      });

    try {
      await this.cache.set(probeKey, 'ok', PROBE_TTL_MS);
      const value = await this.cache.get<string>(probeKey);
      await this.cache.del(probeKey);

      if (value !== 'ok') {
        return down('Cache round-trip returned an unexpected value');
      }

      return indicator.up({
        backend: 'redis',
        ...probeDetails,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const { message: reason, stack } = extractErrorInfo(error);
      this.logger.error({ stack }, `Cache health probe failed: ${reason}`);
      return down(reason);
    }
  }
}
