/**
 * Repository port for the `Layout` aggregate (ADR-0024 domain layer).
 *
 * Four operations, matching exactly what the use cases need — no generic
 * `save(aggregate)` / `findAll()` pair that would force every implementation to
 * guess the query shape.
 *
 * Note there is **no** `delete`: layouts disappear with the user through the
 * database's `onDelete: Cascade`. A standalone delete endpoint was considered
 * and rejected — the client's "reset to defaults" writes the default layout,
 * it does not need to vanish the row.
 */

import type { DomainFailure } from '../../../../common/result/index.js';
import type { LayoutPayload, LayoutState } from './layout.js';
import type { LayoutSurface } from './surface.js';

/** What a write asks the store to persist. */
export interface LayoutWrite {
  readonly userId: string;
  readonly surface: LayoutSurface;
  readonly version: number;
  readonly schemaVersion: number;
  readonly payload: LayoutPayload;
}

export abstract class LayoutRepository {
  /**
   * Every layout the user has, keyed by surface.
   *
   * Surfaces the user never edited are absent from the map — the client falls
   * back to its built-in defaults for those, so materialising empty rows here
   * would only create write amplification.
   */
  abstract findByUser(userId: string): Promise<LayoutState[]>;

  /** One surface's layout, or `null` when the user has none. */
  abstract findOne(
    userId: string,
    surface: LayoutSurface,
  ): Promise<LayoutState | null>;

  /**
   * Insert or update one row, unconditionally.
   *
   * Concurrency is settled by the use case *before* calling this (it compares
   * `ifVersion` against the row it read), so the store does not need a
   * conditional update. The unique constraint on `(userId, surface)` is the
   * backstop: a lost race surfaces as `LAYOUT_VERSION_CONFLICT` via the Prisma
   * unique-violation mapping rather than a 500.
   */
  abstract upsert(write: LayoutWrite): Promise<LayoutState>;
}

/** Re-exported so adapters can name the failure type without importing common. */
export type { DomainFailure };
