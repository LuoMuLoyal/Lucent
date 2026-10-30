/**
 * Layout aggregate (ADR-0024 domain layer).
 *
 * The aggregate is deliberately thin. Layout semantics — which component, in
 * which order, at which size — live entirely in the client, so the only rules
 * that belong here are the two the server must guard:
 *
 * 1. the document's shape version is one this backend accepts (see
 *    `schema-version.ts`);
 * 2. a write carries the version the caller read, so two devices cannot
 *    silently overwrite each other.
 *
 * Everything else is storage. That is why there is no `Placement` / `Component`
 * vocabulary here: modelling them server-side would mean parsing a format the
 * server promised not to parse.
 */

import type { DomainFailure } from '../../../../common/result/index.js';
import { createDomainFailure } from '../../../../common/result/index.js';
import { isSupportedSchemaVersion } from './schema-version.js';
import type { LayoutSurface } from './surface.js';
import { isLayoutSurface } from './surface.js';

/**
 * Opaque client document. The server stores it; it never reads into it.
 *
 * `unknown` rather than `Record<string, unknown>`: page layouts are objects but
 * `tab_chrome`'s payload is an array. Narrowing here would force the server to
 * know which surface carries which shape — exactly what it promised not to do.
 */
export type LayoutPayload = unknown;

/** A stored layout, as the domain sees it. */
export interface LayoutState {
  readonly surface: LayoutSurface;
  readonly version: number;
  readonly schemaVersion: number;
  readonly payload: LayoutPayload;
  readonly updatedAt: Date;
}

/** The changes a save request asks for. */
export interface LayoutSaveRequest {
  readonly surface: string;
  /** The version the client read, or `null` for a first write / blind overwrite. */
  readonly ifVersion: number | null;
  readonly schemaVersion: number;
  readonly payload: LayoutPayload;
}

/**
 * Rejects a save that the server must not accept, before any I/O.
 *
 * Returns the failure instead of throwing so the use case can decide how to
 * surface it (ADR-0012: the domain names failure shapes, adapters map them).
 */
export function validateSaveRequest(
  request: LayoutSaveRequest,
): DomainFailure | null {
  if (!isLayoutSurface(request.surface)) {
    return createDomainFailure({
      kind: 'validation',
      code: 'LAYOUT_SURFACE_UNKNOWN',
      args: { surface: request.surface },
    });
  }

  if (!isSupportedSchemaVersion(request.schemaVersion)) {
    return createDomainFailure({
      kind: 'validation',
      code: 'LAYOUT_SCHEMA_VERSION_UNSUPPORTED',
      args: { schemaVersion: request.schemaVersion },
    });
  }

  return null;
}

/**
 * Decides whether a write may proceed against the stored state.
 *
 * `stored === null` means the user has no layout for this surface yet.
 *
 * `ifVersion === null` means "overwrite regardless": used by a first write and
 * by the client's offline queue replay, which cannot know the current version
 * after a reconnect. Accepting it is deliberate — the alternative would strand
 * an offline edit forever.
 */
export function validateVersionPrecondition(
  stored: LayoutState | null,
  ifVersion: number | null,
): DomainFailure | null {
  if (ifVersion == null) return null;

  // A conditional write against a missing row can only be a stale client: it
  // thinks it has a layout the server does not have.
  if (stored == null) {
    return createDomainFailure({
      kind: 'conflict',
      code: 'LAYOUT_VERSION_CONFLICT',
      args: { ifVersion, currentVersion: 0 },
    });
  }

  if (stored.version !== ifVersion) {
    return createDomainFailure({
      kind: 'conflict',
      code: 'LAYOUT_VERSION_CONFLICT',
      args: { ifVersion, currentVersion: stored.version },
    });
  }

  return null;
}

/** Next version to store, given what the caller holds. */
export function nextVersion(stored: LayoutState | null): number {
  return stored == null ? 1 : stored.version + 1;
}
