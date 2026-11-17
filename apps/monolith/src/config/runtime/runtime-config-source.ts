/**
 * Port between the snapshot service and whatever serves the runtime document.
 *
 * The snapshot service never learns where a document came from beyond these
 * three calls, which keeps the native Nacos binding confined to
 * `rnacos-config-source.ts` and lets the tests drive the service with a fake.
 *
 * Every call returns a discriminated union instead of throwing: a configuration
 * center that is down, misconfigured or has no document published yet is an
 * expected state, not an exception (ADR-0012).
 */

import type { RuntimeConfigSource } from './runtime-config.types.js';

/** A document together with where the adapter read it from. */
export interface RuntimeConfigDocument {
  readonly content: string;
  /**
   * `remote` when the center served it, `local-cache` when it came out of the
   * client's disk cache because the center was unreachable. A cached document
   * may be older than the last release, which is why the snapshot records it.
   */
  readonly origin: Extract<RuntimeConfigSource, 'remote' | 'local-cache'>;
}

/** Why a source call failed; the caller keeps its previous snapshot. */
export type RuntimeConfigSourceFailure = 'unreachable' | 'closed' | 'unknown';

export type RuntimeConfigLoadOutcome =
  | {
      readonly ok: true;
      /** `null` when the center has no document at the configured dataId. */
      readonly document: RuntimeConfigDocument | null;
    }
  | {
      readonly ok: false;
      readonly reason: RuntimeConfigSourceFailure;
      readonly message: string;
    };

export type RuntimeConfigWatchOutcome =
  | { readonly ok: true; readonly stop: () => void }
  | {
      readonly ok: false;
      readonly reason: RuntimeConfigSourceFailure;
      readonly message: string;
    };

/** Adapter contract. One implementation today: rnacos over gRPC. */
export interface RuntimeConfigDocumentSource {
  /** Reads the current document. Called once at bootstrap. */
  load(): Promise<RuntimeConfigLoadOutcome>;
  /** Subscribes to pushes. The returned function stops dispatching to `onDocument`. */
  watch(
    onDocument: (document: RuntimeConfigDocument) => void,
  ): Promise<RuntimeConfigWatchOutcome>;
  /** Releases local state. Safe to call twice. */
  close(): Promise<void>;
}

/** Nest injection token for the optional adapter; `null` when disabled. */
export const RUNTIME_CONFIG_SOURCE = Symbol('RUNTIME_CONFIG_SOURCE');
