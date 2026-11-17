/**
 * Outbound port for the settings read cache.
 *
 * ## Why this is a port and not `CACHE_MANAGER`
 *
 * The application layer must stay runnable without a Nest container, and the
 * cache is the only infrastructure it touches on the read path. Declaring the
 * three operations here keeps `application/` free of `@nestjs/cache-manager`
 * and `keyv` while letting the adapter own the key shape, the TTL and the
 * failure policy (a broken cache degrades to "read the DB", never to a 500).
 *
 * The cached value is the application's own `UserSettingsResource` type — never
 * a read-model-local shape — so the port stays independent of the read model
 * that happens to call it (a port -> read-model edge would be a cycle).
 */

import type { UserSettingsResource } from './user-settings-resource.js';

/** The cached resource (alias kept for adapters that name it). */
export type CachedUserSettings = UserSettingsResource;

export abstract class SettingsCache {
  /** Reads the cached resource, or `undefined` on a miss. */
  abstract read(userId: string): Promise<CachedUserSettings | undefined>;

  /** Stores the rendered resource. */
  abstract write(userId: string, value: CachedUserSettings): Promise<void>;

  /** Drops the entry (idempotent). */
  abstract invalidate(userId: string): Promise<void>;
}
