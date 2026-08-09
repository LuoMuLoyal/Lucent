import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { EnvKey } from '../../config/env/env-keys.enum';

/**
 * Lua script for atomic increment-and-expire.
 *
 * - `INCR` atomically increments the counter.
 * - `PEXPIRE` is called only on the first increment (when count == 1) to
 *   set the TTL in milliseconds.
 *
 * This eliminates the race condition where multiple concurrent requests
 * could read the same stale count and all pass the rate-limit check.
 */
const ATOMIC_INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
` as const;

/**
 * Global provider that manages a singleton ioredis client for services
 * that need direct access to Redis atomic commands (INCR, EVAL, etc.)
 * not exposed through the `cache-manager` abstraction.
 *
 * When `REDIS_URL` is not configured, `isAvailable` is `false` and callers
 * must fall back to a non-atomic path (e.g. cache-based read-check-write).
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private readonly redisUrl: string | null;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.get<string>(EnvKey.REDIS_URL);
    this.redisUrl = url != null && url.trim().length > 0 ? url : null;
  }

  get isAvailable(): boolean {
    return this.client != null;
  }

  async onModuleInit(): Promise<void> {
    if (this.redisUrl == null) {
      this.logger.log('RedisService disabled; REDIS_URL not configured');
      return;
    }
    try {
      const mod = await import('ioredis');
      const RedisCtor = mod.default;
      this.client = new (RedisCtor as unknown as new (url: string) => Redis)(
        this.redisUrl,
      );
      this.logger.log('RedisService connected');
    } catch (error) {
      this.logger.error(
        `Failed to connect Redis for RedisService: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }

  /**
   * Atomically increments a counter and sets the TTL (in milliseconds)
   * on first creation. Returns the count after increment.
   *
   * Uses a Lua script to ensure the INCR + PEXPIRE pair is executed as a
   * single atomic operation — no concurrent request can observe an
   * intermediate state.
   */
  async atomicIncrement(key: string, ttlMs: number): Promise<number> {
    if (this.client == null) {
      throw new Error('Redis is not available');
    }
    const result = await this.client.eval(
      ATOMIC_INCREMENT_SCRIPT,
      1,
      key,
      String(ttlMs),
    );
    return Number(result);
  }
}
