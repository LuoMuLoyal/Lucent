import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type ThrottlerOptionsFactory,
  type ThrottlerModuleOptions,
  type ThrottlerStorage as IThrottlerStorage,
} from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { EnvKey } from '../env/env-keys.enum.js';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Redis-backed implementation of `ThrottlerStorage` using INCR + PEXPIRE.
 *
 * Each rate-limit key maps to a Redis string counter. On first hit, the key
 * is created and given a TTL equal to the throttle window. Subsequent hits
 * simply INCR the counter. If the counter exceeds the limit, the record is
 * marked as blocked with a separate block-expiry key.
 */
class RedisThrottlerStorage implements IThrottlerStorage {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redisKey = `throttler:${throttlerName}:${key}`;
    const blockKey = `${redisKey}:blocked`;

    // Check if currently blocked
    const blockTtl = await this.redis.pttl(blockKey);
    if (blockTtl > 0) {
      return {
        totalHits: limit,
        timeToExpire: 0,
        isBlocked: true,
        timeToBlockExpire: blockTtl,
      };
    }

    const totalHits = await this.redis.incr(redisKey);
    if (totalHits === 1) {
      await this.redis.pexpire(redisKey, ttl);
    }

    const timeToExpire = await this.redis.pttl(redisKey);
    const isBlocked = totalHits > limit;

    if (isBlocked) {
      await this.redis.set(blockKey, '1', 'PX', blockDuration);
      await this.redis.del(redisKey);
      return {
        totalHits,
        timeToExpire: 0,
        isBlocked: true,
        timeToBlockExpire: blockDuration,
      };
    }

    return {
      totalHits,
      timeToExpire: timeToExpire > 0 ? timeToExpire : ttl,
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}

/**
 * Builds throttler options from `ConfigService`. When `REDIS_URL` is set,
 * creates a Redis-backed `ThrottlerStorage` for multi-instance deployments;
 * falls back to default in-memory storage otherwise.
 *
 * Module-level so `ThrottlerModule.forRootAsync({ useFactory, inject })` and
 * the {@link ThrottlerConfigService} (used by direct callers/tests) share the
 * exact same resolution logic.
 */
export async function buildThrottlerOptions(
  configService: ConfigService,
): Promise<ThrottlerModuleOptions> {
  const redisUrl = configService.get<string>(EnvKey.REDIS_URL);

  const options: ThrottlerModuleOptions = {
    throttlers: [{ ttl: 60_000, limit: 100 }],
  };

  if (
    redisUrl &&
    configService.get<string>('OPENAPI_EXPORT_SKIP_REDIS') !== 'true'
  ) {
    try {
      const mod = await import('ioredis');
      const RedisCtor = mod.default;
      options.storage = new RedisThrottlerStorage(
        new (RedisCtor as unknown as new (url: string) => Redis)(redisUrl),
      );
    } catch (error) {
      logger.warn(
        `Failed to connect Redis for throttler storage — falling back to in-memory storage: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return options;
}

const logger = new Logger('ThrottlerConfigService');

@Injectable()
export class ThrottlerConfigService implements ThrottlerOptionsFactory {
  constructor(private readonly configService: ConfigService) {}

  createThrottlerOptions(): Promise<ThrottlerModuleOptions> {
    return buildThrottlerOptions(this.configService);
  }
}
