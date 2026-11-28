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

/**
 * 整个探针（set → get → del）的硬超时。
 *
 * 客户端即便配了 `connectTimeout`，已建立的连接在 Redis 卡死时仍可能无限等待。
 * 探针自身必须有闸，否则健康检查会被一个不响应的依赖拖住。
 */
const PROBE_TIMEOUT_MS = 1_500;

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
      const value = await this.withTimeout(
        (async () => {
          await this.cache.set(probeKey, 'ok', PROBE_TTL_MS);
          const stored = await this.cache.get<string>(probeKey);
          await this.cache.del(probeKey);
          return stored;
        })(),
        PROBE_TIMEOUT_MS,
      );
      if (value !== 'ok') {
        return down('Cache round-trip returned an unexpected value');
      }
    } catch (error) {
      const { message: reason, stack } = extractErrorInfo(error);
      this.logger.error({ stack }, `Cache health probe failed: ${reason}`);
      return down(reason);
    }

    return indicator.up({
      backend: 'redis',
      ...probeDetails,
      durationMs: Date.now() - startedAt,
    });
  }

  /**
   * 给探针套一层硬超时。超时后抛错，由调用方的 catch 统一转成 `down`。
   *
   * 用 `Promise.race` 而不是 `AbortController`：cache-manager 的 `get/set/del`
   * 不接受 signal，无法真正取消底层命令；能让出的只是「探针不再等它」。
   * 未完成的命令会由客户端自身的 `connectTimeout` / socket 超时兜底。
   */
  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Cache probe timed out after ${String(timeoutMs)}ms`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}
