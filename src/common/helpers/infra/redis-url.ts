/**
 * Shared Redis URL parser used by both the BullMQ queue factory and the
 * cache store so that connection options stay consistent in one place.
 *
 * Supported input forms:
 * - `redis://` / `rediss://` schemes (`rediss:` enables TLS)
 * - pathname as db index (e.g. `redis://host:6379/3`)
 * - username / password credentials
 * - query params: `family` (e.g. AWS ElastiCache `?family=0`) and `db`
 *   override (takes precedence over the pathname db).
 */

/** Default Redis port used when the URL does not specify one. */
const REDIS_DEFAULT_PORT = 6379;

export interface RedisConnectionOptions {
  host: string;
  port: number;
  db: number;
  username?: string;
  password?: string;
  tls?: Record<string, never>;
  family?: number;
}

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
