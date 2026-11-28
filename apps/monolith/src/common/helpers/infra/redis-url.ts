/**
 * Shared Redis connection resolution for every Redis consumer in the app.
 *
 * 本模块负责把「单实例 URL」与「Sentinel 地址表」两种部署形态归一成各客户端
 * 需要的形状。四个消费者各自需要不同的库：
 *
 * | 消费者                   | 客户端     | 需要的形状                     |
 * | ------------------------ | ---------- | ------------------------------ |
 * | BullMQ `queue.factory`   | ioredis    | `{ sentinels, name }` 或 host/port |
 * | 限流 `throttler.config`  | ioredis    | 同上                            |
 * | 缓存 `cache.config`      | node-redis | `{ url }` 或 `{ socket, sentinels }` |
 * | `RedisService`           | ioredis    | 同上                            |
 *
 * ## Sentinel 配置从哪来
 *
 * - `REDIS_URL`：单实例时的完整 URL；Sentinel 部署下可留空。
 * - `REDIS_SENTINELS`：逗号分隔的 `host:port` 列表（Sentinel 进程的地址，
 *   **不是** Redis 主从的地址）。
 * - `REDIS_MASTER_NAME`：Sentinel 里被监控的 master 名称（默认 `mymaster`）。
 * - `REDIS_PASSWORD`：Redis 数据节点的口令（Sentinel 部署下仍需）。URL 形式
 *   也可以在 `REDIS_URL` 里带，但 Sentinel 模式下必须单独给。
 *
 * 三者齐备即视为启用 Sentinel；否则按 `REDIS_URL` 走单实例。
 */

/** Default Redis port used when the URL does not specify one. */
const REDIS_DEFAULT_PORT = 6379;

/** ioredis 形状的连接选项（单实例）。 */
export interface RedisConnectionOptions {
  host: string;
  port: number;
  db: number;
  username?: string;
  password?: string;
  tls?: Record<string, never>;
  family?: number;
}

/** 一个 Sentinel 进程的地址。 */
export interface RedisSentinelAddress {
  host: string;
  port: number;
}

/** Sentinel 部署的连接描述，供各客户端按需展开。 */
export interface RedisSentinelOptions {
  sentinels: RedisSentinelAddress[];
  /** Sentinel 监控的 master 名。 */
  name: string;
  db: number;
  username?: string;
  password?: string;
  /** 数据节点与 Sentinel 的口令可能不同；这里只表达数据节点口令。 */
  sentinelPassword?: string;
  tls?: Record<string, never>;
}

/**
 * 归一后的 Redis 连接描述。
 *
 * `mode` 让调用方明确知道该走哪条分支，而不是靠字段是否为 `undefined` 猜。
 */
export type RedisConnection =
  | { mode: 'standalone'; options: RedisConnectionOptions }
  | { mode: 'sentinel'; options: RedisSentinelOptions };

export function parseRedisUrl(
  rawUrl: string | null | undefined,
): RedisConnectionOptions {
  if (rawUrl == null || rawUrl.trim() === '') {
    throw new Error('Redis URL is required but received an empty value.');
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      `Invalid Redis URL: "${rawUrl}". Expected format: redis://host:port/db`,
    );
  }

  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error(
      `Invalid Redis URL scheme: "${url.protocol}" in "${rawUrl}". Expected "redis://" or "rediss://".`,
    );
  }

  const dbOverride = url.searchParams.get('db');
  const family = url.searchParams.get('family');
  const pathDb = url.pathname ? Number(url.pathname.slice(1)) || 0 : 0;

  return {
    // URL.hostname keeps brackets for IPv6 (e.g. "[::1]"), but Redis clients
    // expect the bare address ("::1"). Strip them here for both ioredis and
    // BullMQ compatibility.
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: Number(url.port) || REDIS_DEFAULT_PORT,
    db: dbOverride != null ? Number(dbOverride) || 0 : pathDb,
    ...(url.username ? { username: url.username } : {}),
    ...(url.password ? { password: url.password } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    ...(family != null && family !== '' ? { family: Number(family) } : {}),
  };
}

/**
 * 解析逗号分隔的 Sentinel 地址表，如 `"10.0.0.1:26379,10.0.0.2:26379"`。
 *
 * 空项被忽略；缺少端口时用 Sentinel 默认端口 26379。
 */
export function parseSentinelAddresses(
  raw: string | null | undefined,
): RedisSentinelAddress[] {
  if (raw == null || raw.trim() === '') {
    return [];
  }
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const idx = entry.lastIndexOf(':');
      if (idx <= 0) {
        return { host: entry, port: 26379 };
      }
      const host = entry.slice(0, idx);
      const port = Number(entry.slice(idx + 1));
      if (!Number.isInteger(port) || port <= 0) {
        throw new Error(
          `Invalid Sentinel address "${entry}": port must be a positive integer.`,
        );
      }
      return { host: host.replace(/^\[|\]$/g, ''), port };
    });
}

/**
 * 从环境变量归一出 Redis 连接描述。
 *
 * Sentinel 的判据是 `REDIS_SENTINELS` 非空。这样：
 * - 单实例部署完全不用改（只写 `REDIS_URL`）；
 * - 启用 Sentinel 只需加一个变量，`REDIS_URL` 可以留着也可以删掉。
 */
export function resolveRedisConnection(env: {
  REDIS_URL?: string | undefined;
  REDIS_SENTINELS?: string | undefined;
  REDIS_MASTER_NAME?: string | undefined;
  REDIS_PASSWORD?: string | undefined;
  REDIS_SENTINEL_PASSWORD?: string | undefined;
}): RedisConnection | null {
  const sentinels = parseSentinelAddresses(env.REDIS_SENTINELS);
  if (sentinels.length > 0) {
    const url = env.REDIS_URL?.trim() ? parseRedisUrl(env.REDIS_URL) : undefined;
    return {
      mode: 'sentinel',
      options: {
        sentinels,
        name: env.REDIS_MASTER_NAME?.trim() || 'mymaster',
        // Sentinel 模式下 db 从 REDIS_URL 取（如果有），否则 0。
        db: url?.db ?? 0,
        ...(url?.username != null ? { username: url.username } : {}),
        ...(env.REDIS_PASSWORD?.trim()
          ? { password: env.REDIS_PASSWORD.trim() }
          : url?.password != null
            ? { password: url.password }
            : {}),
        ...(env.REDIS_SENTINEL_PASSWORD?.trim()
          ? { sentinelPassword: env.REDIS_SENTINEL_PASSWORD.trim() }
          : {}),
        ...(url?.tls != null ? { tls: url.tls } : {}),
      },
    };
  }

  if (env.REDIS_URL?.trim()) {
    return { mode: 'standalone', options: parseRedisUrl(env.REDIS_URL) };
  }
  return null;
}

/**
 * ioredis 的 `ConnectionOptions`（BullMQ 与限流共用）。
 *
 * Sentinel 与单实例的区别只在字段形状：ioredis 用 `sentinels` + `name`，
 * 单实例用 `host` + `port`。
 */
export function toIoredisOptions(
  connection: RedisConnection,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  if (connection.mode === 'sentinel') {
    return {
      sentinels: connection.options.sentinels,
      name: connection.options.name,
      db: connection.options.db,
      ...(connection.options.username != null
        ? { username: connection.options.username }
        : {}),
      ...(connection.options.password != null
        ? { password: connection.options.password }
        : {}),
      ...(connection.options.sentinelPassword != null
        ? { sentinelPassword: connection.options.sentinelPassword }
        : {}),
      ...(connection.options.tls != null ? { tls: connection.options.tls } : {}),
      ...overrides,
    };
  }
  return { ...connection.options, ...overrides };
}

/**
 * node-redis（`@keyv/redis` 用的客户端）的 `RedisClientOptions`。
 *
 * node-redis 的 Sentinel 形状与 ioredis 不同：它用 `sentinels` + `name`，
 * 但口令字段叫 `password`（数据节点）与 `sentinelPassword`（Sentinel 自身）。
 */
export function toNodeRedisOptions(
  connection: RedisConnection,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  if (connection.mode === 'sentinel') {
    return {
      sentinels: connection.options.sentinels,
      name: connection.options.name,
      database: connection.options.db,
      ...(connection.options.username != null
        ? { username: connection.options.username }
        : {}),
      ...(connection.options.password != null
        ? { password: connection.options.password }
        : {}),
      ...(connection.options.sentinelPassword != null
        ? { sentinelPassword: connection.options.sentinelPassword }
        : {}),
      ...(connection.options.tls != null ? { tls: connection.options.tls } : {}),
      ...overrides,
    };
  }
  const { db, ...rest } = connection.options;
  return { database: db, ...rest, ...overrides };
}