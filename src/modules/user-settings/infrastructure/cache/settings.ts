/**
 * Cache adapter: `SettingsCache` on top of the shared `CACHE_MANAGER`.
 *
 * ## Failures degrade, they do not propagate
 *
 * The cache is an optimisation. A Redis outage must not turn `GET /settings`
 * into a 500, so every backend call is wrapped: log, then behave as a miss (for
 * reads) or as a silent no-op (for writes/deletes). `error-handling/no-silent-catch`
 * is satisfied by the log call.
 *
 * ## Key and TTL
 *
 * `user-settings:{userId}`, ten minutes. The key builder is exported because
 * anyone evicting from outside must produce the exact same string rather than
 * restating the format (a copy of this format is what the previous
 * implementation exported as `userSettingsCacheKey`).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import type { CachedUserSettings } from '../../application/ports/settings-cache.js';
import { SettingsCache } from '../../application/ports/settings-cache.js';

/** Cache key prefix for user settings. */
const USER_SETTINGS_CACHE_KEY_PREFIX = 'user-settings';

/** Entry lifetime: settings change rarely; derived dashboards tolerate 10 min. */
const USER_SETTINGS_CACHE_TTL_MS = 10 * 60 * 1000;

export function userSettingsCacheKey(userId: string): string {
  return `${USER_SETTINGS_CACHE_KEY_PREFIX}:${userId}`;
}

@Injectable()
export class CacheSettings extends SettingsCache {
  private readonly logger = new Logger(CacheSettings.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {
    super();
  }

  async read(userId: string): Promise<CachedUserSettings | undefined> {
    const key = userSettingsCacheKey(userId);
    try {
      const cached = await this.cache.get<CachedUserSettings>(key);
      return cached ?? undefined;
    } catch (error) {
      this.logger.warn(`User settings cache get failed (key=${key})`, {
        error,
      });
      return undefined;
    }
  }

  async write(userId: string, value: CachedUserSettings): Promise<void> {
    const key = userSettingsCacheKey(userId);
    try {
      await this.cache.set(key, value, USER_SETTINGS_CACHE_TTL_MS);
    } catch (error) {
      this.logger.warn(`User settings cache set failed (key=${key})`, {
        error,
      });
    }
  }

  async invalidate(userId: string): Promise<void> {
    const key = userSettingsCacheKey(userId);
    try {
      await this.cache.del(key);
    } catch (error) {
      this.logger.warn(`User settings cache delete failed (key=${key})`, {
        error,
      });
    }
  }
}
