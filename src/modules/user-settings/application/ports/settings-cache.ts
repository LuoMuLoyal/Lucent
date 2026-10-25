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
 * ## Why the cached shape is declared here
 *
 * The cache stores exactly what `GET /settings` returns. Naming that shape in
 * this file (the port) rather than importing it from the read model keeps the
 * dependency one-way: read model -> port, never port -> read model. A `type`
 * cycle would be invisible at runtime but breaks the D2 direction check.
 */

/** The cached resource: the rendered settings document, dates as ISO strings. */
export interface CachedUserSettings {
  aiSummariesEnabled: boolean;
  dataSharingConsent: boolean;
  assistantEnabled: boolean;
  assistantMemoryEnabled: boolean;
  waterTargetCount: number;
  assistantContext: {
    healthProfile: boolean;
    dailyRecords: boolean;
    sleepRecords: boolean;
    currentMedicines: boolean;
  };
  updatedAt: string | null;
  passwordReauthenticationRequired: boolean;
}

export abstract class SettingsCache {
  /** Reads the cached resource, or `undefined` on a miss. */
  abstract read(userId: string): Promise<CachedUserSettings | undefined>;

  /** Stores the rendered resource. */
  abstract write(userId: string, value: CachedUserSettings): Promise<void>;

  /** Drops the entry (idempotent). */
  abstract invalidate(userId: string): Promise<void>;
}
