/**
 * Holds the current runtime-config snapshot and applies new documents.
 *
 * The apply sequence is fixed (plan §5): parse -> validate -> merge onto the
 * baseline -> freeze -> swap the reference -> notify. Anything that fails
 * before the swap leaves the previous snapshot untouched, so a rejected
 * document is a log line, never a half-applied configuration.
 *
 * Each document is merged onto the **environment baseline**, not onto the
 * previous document. The document is a complete declaration of the overrides
 * in force, so a key that disappears from it returns to its baseline value —
 * that is the rollback path for a single field (plan §15.2).
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  buildRuntimeConfigBaseline,
  BASELINE_RUNTIME_CONFIG_VERSION,
} from './runtime-config.baseline.js';
import {
  freezeRuntimeConfigValues,
  parseRuntimeConfigDocument,
  RUNTIME_CONFIG_KEYS,
  type RuntimeConfigValues,
} from './runtime-config.schema.js';
import type {
  RuntimeConfigApplyResult,
  RuntimeConfigListener,
  RuntimeConfigPort,
  RuntimeConfigSnapshot,
  RuntimeConfigSource,
} from './runtime-config.types.js';

function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((v, i) => v === right[i]);
  }
  return left === right;
}

@Injectable()
export class RuntimeConfigService implements RuntimeConfigPort {
  private readonly logger = new Logger(RuntimeConfigService.name);
  private readonly listeners = new Set<RuntimeConfigListener>();
  private readonly baseline: RuntimeConfigValues;
  private snapshot: RuntimeConfigSnapshot;
  private seq = 0;

  constructor() {
    this.baseline = buildRuntimeConfigBaseline();
    this.snapshot = {
      values: freezeRuntimeConfigValues(this.baseline),
      version: BASELINE_RUNTIME_CONFIG_VERSION,
      source: 'env',
      revision: null,
      seq: 0,
    };
  }

  getSnapshot(): RuntimeConfigSnapshot {
    return this.snapshot;
  }

  getVersion(): string {
    return this.snapshot.version;
  }

  /**
   * Applies a document published by the configuration center.
   *
   * {@link applyDocumentFrom} exists for the source adapter, which knows whether
   * the document it read came over the wire or from the client's disk cache.
   */
  applyDocument(raw: string): RuntimeConfigApplyResult {
    return this.applyDocumentFrom(raw, 'remote');
  }

  applyDocumentFrom(
    raw: string,
    source: RuntimeConfigSource,
  ): RuntimeConfigApplyResult {
    const parsed = parseRuntimeConfigDocument(raw);
    if (!parsed.ok) {
      this.logger.warn(
        `Rejected runtime config document (${parsed.reason}): ${parsed.message}`,
      );
      return parsed;
    }

    const previous = this.snapshot.values;
    const next: RuntimeConfigValues = { ...this.baseline, ...parsed.overrides };
    const changed = RUNTIME_CONFIG_KEYS.filter(
      (key) => !sameValue(previous[key], next[key]),
    );

    const seq = this.seq + 1;
    const version = `${parsed.revision}#${String(seq)}`;
    const snapshot: RuntimeConfigSnapshot = {
      values: freezeRuntimeConfigValues(next),
      version,
      source,
      revision: parsed.revision,
      seq,
    };

    this.snapshot = snapshot;
    this.seq = seq;
    this.logger.log(
      `Applied runtime config ${version} (source=${source}, changed=${
        changed.length > 0 ? changed.join(',') : 'none'
      })`,
    );
    this.notify(snapshot);
    return { ok: true, version, changed };
  }

  subscribe(listener: RuntimeConfigListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notifies every listener. A listener that throws must not stop the others or
   * fail the apply — the snapshot is already published at this point.
   */
  private notify(snapshot: RuntimeConfigSnapshot): void {
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        this.logger.error(
          `Runtime config listener failed on ${snapshot.version}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
