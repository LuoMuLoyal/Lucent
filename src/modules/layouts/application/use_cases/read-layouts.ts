/**
 * Read the user's layouts (ADR-0024 application layer).
 *
 * Two entry points sharing one repository read:
 *
 * - `list`: every surface the user has a layout for. Surfaces without a row are
 *   simply absent — the client falls back to its built-in defaults, so the
 *   server never needs to invent them.
 * - `get`: one surface. Missing means 404 rather than an empty document,
 *   because "the user never customised this page" and "this page's layout is
 *   empty" are different things and the client acts differently on them.
 *
 * Rows whose `surface` this build does not recognise are dropped on read. They
 * can only come from a newer client (or a surface removed in a later release),
 * and surfacing them would make `GET /layouts` depend on which client version
 * last wrote — the same reasoning as the host skipping unknown component ids.
 */

import { Injectable } from '@nestjs/common';

import type { DomainFailure } from '../../../../common/result/index.js';
import {
  createDomainFailure,
  errAsync,
  okAsync,
  ResultAsync,
} from '../../../../common/result/index.js';
import type { LayoutState } from '../../domain/layout/layout.js';
import { LayoutRepository } from '../../domain/layout/layouts.js';
import type { LayoutSurface } from '../../domain/layout/surface.js';
import { isLayoutSurface } from '../../domain/layout/surface.js';

/** Result of listing: a map keyed by surface, ready to serialise. */
export type LayoutMap = Partial<Record<LayoutSurface, LayoutState>>;

@Injectable()
export class ReadLayouts {
  constructor(private readonly layouts: LayoutRepository) {}

  async list(userId: string): Promise<LayoutMap> {
    const rows = await this.layouts.findByUser(userId);
    const map: LayoutMap = {};
    for (const row of rows) {
      if (!isLayoutSurface(row.surface)) continue;
      map[row.surface] = row;
    }
    return map;
  }

  get(
    userId: string,
    surface: LayoutSurface,
  ): ResultAsync<LayoutState, DomainFailure> {
    // `ResultAsync.fromPromise` funnels both the query rejection and the
    // "not found" branch through one error channel, which is what lets
    // `unwrapResult` stay a single call at the controller.
    return ResultAsync.fromPromise(
      this.layouts.findOne(userId, surface),
      (error): DomainFailure => {
        // Infrastructure errors are not domain failures: re-throw so the global
        // filter reports them as 5xx instead of masking them as a 404.
        throw error;
      },
    ).andThen((row) =>
      row == null
        ? errAsync(
            createDomainFailure({
              kind: 'not_found',
              code: 'RESOURCE_NOT_FOUND',
              detail: `layout not found for surface "${surface}"`,
            }),
          )
        : okAsync(row),
    );
  }
}
