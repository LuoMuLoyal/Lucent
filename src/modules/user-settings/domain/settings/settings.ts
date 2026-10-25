/**
 * Repository port for the `UserSettings` aggregate (ADR-0024).
 *
 * ## Why upsert-by-key instead of `save(aggregate)`
 *
 * The aggregate materialises every field from defaults, so saving it wholesale
 * would write all eleven rows on every single-field toggle (`PATCH` only ever
 * sends what changed). The port therefore exposes exactly the storage action
 * the use case needs: "write these keys, leave the rest alone".
 *
 * ## Failure type is a type-only edge
 *
 * `DomainFailure` is a frozen plain object from `common/result`; the domain only
 * names its shape. D1 permits that type-only import (no runtime dependency, no
 * framework, no I/O) and `.dependency-cruiser.cjs` exempts type-only imports
 * for the domain-purity rule.
 */

import type { DomainFailure } from '../../../../common/result/index.js';

/** A stored row: the persisted key, its raw JSON-ish value, and its stamp. */
export interface SettingRowSnapshot {
  key: string;
  value: unknown;
  updatedAt: Date;
}

/** One row to write, already resolved to its persisted key and value. */
export interface SettingRowUpsert {
  key: string;
  value: boolean | number;
}

export abstract class SettingsRepository {
  /**
   * All rows for the user, newest first.
   *
   * Newest-first is part of the contract: the aggregate takes
   * `rows[0].updatedAt` as the resource's `updatedAt`.
   */
  abstract listRows(userId: string): Promise<SettingRowSnapshot[]>;

  /**
   * Upsert the given rows in one call.
   *
   * An empty list is a no-op — implementations must not issue SQL for it. A
   * unique violation surfaces as `RESOURCE_CONFLICT` (ADR-0012).
   */
  abstract upsertMany(
    userId: string,
    upserts: SettingRowUpsert[],
  ): Promise<void>;

  /**
   * Materialise one row per known boolean setting when the user has none.
   *
   * Used at account provisioning; idempotent (`createMany` + skip duplicates),
   * so calling it twice is harmless.
   */
  abstract seedDefaults(
    userId: string,
    defaults: ReadonlyArray<SettingRowUpsert>,
  ): Promise<void>;
}

/** Re-exported so adapters can name the failure type without importing common. */
export type { DomainFailure };
