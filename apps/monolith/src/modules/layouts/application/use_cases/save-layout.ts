/**
 * Save one surface's layout (ADR-0024 application layer).
 *
 * Ordered guards, cheapest first:
 *
 * 1. **Request shape** — known surface, supported `schemaVersion`. Pure, no I/O.
 * 2. **Precondition** — read the stored row, compare `ifVersion`. A mismatch
 *    returns `LAYOUT_VERSION_CONFLICT` *with the current document attached*, so
 *    the client can adopt the server's copy instead of re-fetching.
 * 3. **Write** — bump `version` and persist.
 *
 * ## Why no automatic merge
 *
 * A layout is an ordered list. Merging two different orders has no correct
 * answer — any result is one user's arrangement with another user's edits
 * silently folded in. Server-wins plus an explicit "another device updated
 * this" prompt is the honest outcome, and it is what the plan committed to.
 *
 * ## Why `ifVersion: null` is accepted
 *
 * The client's offline queue replays after a reconnect and cannot know the
 * current version. Rejecting it would strand the edit forever. It is treated as
 * a blind overwrite — last writer wins — which is exactly what the user's
 * offline edit meant.
 */

import { Injectable } from '@nestjs/common';

import type { DomainFailure } from '../../../../common/result/index.js';
import { errAsync, ResultAsync } from '../../../../common/result/index.js';
import type { LayoutPayload, LayoutState } from '../../domain/layout/layout.js';
import {
  nextVersion,
  validateSaveRequest,
  validateVersionPrecondition,
} from '../../domain/layout/layout.js';
import { LayoutRepository } from '../../domain/layout/layouts.js';
import type { LayoutSurface } from '../../domain/layout/surface.js';

/** What the caller asks to persist. */
export interface SaveLayoutInput {
  readonly userId: string;
  readonly surface: string;
  readonly ifVersion: number | null;
  readonly schemaVersion: number;
  readonly payload: LayoutPayload;
}

/** Outcome of a save: the stored document, or the conflict that blocked it. */
export type SaveLayoutResult =
  | { readonly saved: LayoutState }
  | { readonly conflict: LayoutState | null };

@Injectable()
export class SaveLayout {
  constructor(private readonly layouts: LayoutRepository) {}

  execute(
    input: SaveLayoutInput,
  ): ResultAsync<SaveLayoutResult, DomainFailure> {
    // 1. Shape guards — no I/O for an obviously bad request.
    const shapeFailure = validateSaveRequest(input);
    if (shapeFailure != null) return errAsync(shapeFailure);

    // `validateSaveRequest` proved this is a known surface.
    const surface = input.surface as LayoutSurface;

    return ResultAsync.fromPromise(
      this.readAndWrite(input, surface),
      (error): DomainFailure => {
        // Write failures (unique-violation conflicts are already mapped to a
        // DomainFailureException by the repository) must not be reported as a
        // 4xx here — re-throw so the global filter treats them as 5xx.
        throw error;
      },
    );
  }

  private async readAndWrite(
    input: SaveLayoutInput,
    surface: LayoutSurface,
  ): Promise<SaveLayoutResult> {
    // 2. Precondition against current state.
    const stored = await this.layouts.findOne(input.userId, surface);
    const preconditionFailure = validateVersionPrecondition(
      stored,
      input.ifVersion,
    );
    if (preconditionFailure != null) {
      return { conflict: stored };
    }

    // 3. Write.
    const saved = await this.layouts.upsert({
      userId: input.userId,
      surface,
      version: nextVersion(stored),
      schemaVersion: input.schemaVersion,
      payload: input.payload,
    });
    return { saved };
  }
}
