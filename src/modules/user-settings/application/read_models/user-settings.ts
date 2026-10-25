/**
 * Read model: the authenticated user's settings resource
 * (`GET /api/v1/user/settings`).
 *
 * Assembles the `UserSettings` aggregate and renders it as the resource the
 * application layer exposes. The controller and the cross-context port both read
 * through here; it owns no invariants and no repository of its own beyond the
 * aggregate's port (ADR-0024 section 4).
 *
 * ## Cache stores the rendered resource, not the aggregate
 *
 * The resource is plain JSON (ISO strings, no `Date`), so it survives any cache
 * backend and any serialisation change without a migration. A cached entry keeps
 * the stamp from when it was written; writes invalidate, so it can never be
 * staler than the last successful `PATCH`.
 */

import { Injectable } from '@nestjs/common';

import type { UserSettingsSnapshot } from '../../domain/settings/user-settings.js';
import { UserSettings } from '../../domain/settings/user-settings.js';
import { SettingsRepository } from '../../domain/settings/settings.js';
import { SettingsCache } from '../ports/settings-cache.js';
import type { UserSettingsResource } from '../ports/user-settings-resource.js';

export type UserSettingsView = UserSettingsResource;

/**
 * `@Injectable()` is load-bearing, not decorative: without it the SWC builder
 * emits no `design:paramtypes` for this class, so Nest constructs it with
 * `undefined` dependencies and the failure only shows up as
 * "Cannot read properties of undefined (reading 'read')" at request time.
 */
@Injectable()
export class UserSettingsReadModel {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly cache: SettingsCache,
  ) {}

  /** Returns the resource, serving it from cache when present. */
  async get(userId: string): Promise<UserSettingsResource> {
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

  /** Drops the cached resource; the next `get` re-assembles from storage. */
  async invalidate(userId: string): Promise<void> {
    await this.cache.invalidate(userId);
  }
}

function render(snapshot: UserSettingsSnapshot): UserSettingsResource {
  return {
    ...snapshot,
    updatedAt: snapshot.updatedAt?.toISOString() ?? null,
  };
}
