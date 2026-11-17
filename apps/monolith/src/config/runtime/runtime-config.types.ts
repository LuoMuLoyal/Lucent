/**
 * Public types of the runtime-config snapshot.
 *
 * Consumers only ever see this module: they read a frozen snapshot, never the
 * configuration center, and never a native module. That keeps the Nacos binding
 * confined to one adapter file (`rnacos-config-source.ts`).
 */

import type { RuntimeConfigFamily } from './schema/field-spec.js';
import type {
  RuntimeConfigRejectionReason,
  RuntimeConfigValues,
} from './runtime-config.schema.js';

export type { RuntimeConfigFamily, RuntimeConfigRejectionReason };

/**
 * Where the current snapshot came from.
 *
 * - `env`: the startup baseline, built from the environment.
 * - `remote`: a document served by the configuration center.
 * - `local-cache`: a document read from the client's on-disk cache because the
 *   center was unreachable — the values may be older than the last release.
 */
export type RuntimeConfigSource = 'env' | 'remote' | 'local-cache';

export interface RuntimeConfigSnapshot {
  readonly values: Readonly<RuntimeConfigValues>;
  /** `<revision>#<seq>` for applied documents, `env#0` for the baseline. */
  readonly version: string;
  readonly source: RuntimeConfigSource;
  /** Revision declared by the document; `null` for the baseline. */
  readonly revision: string | null;
  readonly seq: number;
}

export type RuntimeConfigListener = (snapshot: RuntimeConfigSnapshot) => void;

export type RuntimeConfigApplyResult =
  | {
      readonly ok: true;
      readonly version: string;
      /** Keys whose resolved value differs from the previous snapshot. */
      readonly changed: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: RuntimeConfigRejectionReason;
      readonly message: string;
    };

export interface RuntimeConfigPort {
  /** Current snapshot. Never null: the baseline exists before any remote call. */
  getSnapshot(): RuntimeConfigSnapshot;
  getVersion(): string;
  /** Parses, validates and applies a document atomically. */
  applyDocument(raw: string): RuntimeConfigApplyResult;
  /** Registers a listener; the returned function unsubscribes. */
  subscribe(listener: RuntimeConfigListener): () => void;
}
