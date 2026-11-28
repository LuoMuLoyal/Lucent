import { Injectable } from '@nestjs/common';
import { CacheOptionsFactory, CacheModuleOptions } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { createKeyv } from '@keyv/redis';
import { EnvKey } from '../env/env-keys.enum.js';

/**
 * 缓存客户端建连超时。
 *
 * 不设超时时，Redis 不可达会让命令一直等到 socket 层放弃，进而把依赖它的请求
 * 和健康检查一起挂住。2 秒覆盖正常内网往返，同时保证失败快速可见。
 */
const REDIS_CONNECT_TIMEOUT_MS = 2_000;

/**
 * 命令排队上限（与 `disableOfflineQueue` 配合）。
 *
 * 关闭离线队列后断连直接 reject；保留上限是防止极端重连抖动下队列无限增长。
 */
const REDIS_COMMANDS_QUEUE_MAX_LENGTH = 1_000;

/**
 * Cache store factory: prefers a Redis-backed Keyv store when `REDIS_URL` is
 * configured, falling back to the in-memory default otherwise.
 *
 * `@keyv/redis` is the store family the NestJS cache-manager docs recommend
 * for cache-manager v6+ (Keyv-based); it replaces the deprecated
 * `cache-manager-ioredis-yet` adapter.
 *
 * ## 为什么传连接选项而不是裸 URL
 *
 * 只传字符串时 `@keyv/redis` 用 node-redis 的默认值，其中没有连接超时：
 * Redis 不可达时命令会等到 socket 层放弃，健康检查随之被拖住。
 *
 * 这里不复用 `parseRedisUrl()`：它产出的是 ioredis 形状
 * （`host`/`port`/`db`/`family`），而 `@keyv/redis` 走 node-redis，选项结构不兼容。
 * 缓存这层直接用 node-redis 的 `url` 字段。BullMQ 的 `queue.factory.ts` 仍用
 * `parseRedisUrl`，两者语义不同是有意为之：
 *
 * - worker 连接需要 `maxRetriesPerRequest: null`（持续重连等待）；
 * - 缓存读必须快速失败（`disableOfflineQueue`），否则一次 Redis 抖动就把请求全挂住。
 */
@Injectable()
export class CacheConfigService implements CacheOptionsFactory {
  constructor(private readonly configService: ConfigService) {}

  createCacheOptions(): CacheModuleOptions {
    const redisUrl = this.configService.get<string>(EnvKey.REDIS_URL);

    if (
      redisUrl &&
      this.configService.get<string>(EnvKey.OPENAPI_EXPORT_SKIP_REDIS) !==
        'true'
    ) {
      return {
        stores: [
          createKeyv({
            url: redisUrl,
            socket: {
              connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
              keepAlive: true,
            },
            disableOfflineQueue: true,
            commandsQueueMaxLength: REDIS_COMMANDS_QUEUE_MAX_LENGTH,
          }),
        ],
        ttl: 5 * 60 * 1000,
      };
    }

    return {
      ttl: 5 * 60 * 1000,
    };
  }
}
