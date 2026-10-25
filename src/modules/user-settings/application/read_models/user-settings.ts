/**
 * Read model: the authenticated user's settings resource
 * (`GET /api/v1/user/settings`).
 *
 * Assembles the `UserSettings` aggregate and renders it as the wire shape. The
 * controller and the cross-context port both read through here; it owns no
 * invariants and no repository of its own beyond the aggregate's port
 * (ADR-0024 §4).
 *
 * ## Cache stores the rendered view, not the aggregate
 *
 * `UserSettingsView` is plain JSON (ISO strings, no `Date`), so it survives any
 * cache backend and any serialisation change without a migration. The one
 * caveat: a cached entry does not re-round `updatedAt` against wall clock — it
 * is the stamp from when the entry was written, refreshed on every write
 * because writes invalidate.
 */

import type { UserSettingsSnapshot } from '../../domain/settings/user-settings.js';
import { UserSettings } from '../../domain/settings/user-settings.js';
import type { SettingsRepository } from '../../domain/settings/settings.js';
import type { CachedUserSettings } from '../ports/settings-cache.js';
import type { SettingsCache } from '../ports/settings-cache.js';

/** Wire shape of the settings resource. Dates are ISO-8601 strings or null. */
export type UserSettingsView = CachedUserSettings;

export class UserSettingsReadModel {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly cache: SettingsCache,
  ) {}

  /** Returns the resource, serving it from cache when present. */
  async get(userId: string): Promise<UserSettingsView> {
    const cached = await this.cache.read(userId);
    if (cached != null) {
      return cached;
    }

    const aggregate = await this.load(userId);
    const view = render(aggregate.toSnapshot());
    await this.cache.write(userId, view);
    return view;
  }

  /** Loads the aggregate straight from storage (no cache). */
  async load(userId: string): Promise<UserSettings> {
    const rows = await this.repository.listRows(userId);
    return UserSettings.fromRows(userId, rows);
  }

  /** Drops the cached view; the next `get` re-assembles from storage. */
  async invalidate(userId: string): Promise<void> {
    await this.cache.invalidate(userId);
  }
}

function render(snapshot: UserSettingsSnapshot): UserSettingsView {
  return {
    ...snapshot,
    updatedAt: snapshot.updatedAt?.toISOString() ?? null,
  };
}
