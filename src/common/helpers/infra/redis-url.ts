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

export interface RedisConnectionOptions {
  host: string;
  port: number;
  db: number;
  username?: string;
  password?: string;
  tls?: Record<string, never>;
  family?: number;
}

export function parseRedisUrl(rawUrl: string): RedisConnectionOptions {
  const url = new URL(rawUrl);
  const dbOverride = url.searchParams.get('db');
  const family = url.searchParams.get('family');
  const pathDb = url.pathname ? Number(url.pathname.slice(1)) || 0 : 0;

  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    db: dbOverride != null ? Number(dbOverride) || 0 : pathDb,
    ...(url.username ? { username: url.username } : {}),
    ...(url.password ? { password: url.password } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    ...(family != null && family !== '' ? { family: Number(family) } : {}),
  };
}
