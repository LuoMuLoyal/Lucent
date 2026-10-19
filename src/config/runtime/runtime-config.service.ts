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
 *
 * When a document source is injected (`RNACOS_ENABLED=true`), bootstrap loads
 * the document once and then subscribes to pushes. Every source failure — no
 * document, unreachable center, bad credentials — is a warning, never a
 * startup failure: the environment baseline always exists, so the process is
 * never dependent on the configuration center being up (plan §16).
 */

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  buildRuntimeConfigBaseline,
  BASELINE_RUNTIME_CONFIG_VERSION,
} from './runtime-config.baseline.js';
import {
  RUNTIME_CONFIG_SOURCE,
  type RuntimeConfigDocumentSource,
} from './runtime-config-source.js';
import { fingerprintPrompt, RUNTIME_PROMPT_KEYS } from './prompt-registry.js';
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
export class RuntimeConfigService
  implements RuntimeConfigPort, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RuntimeConfigService.name);
  private readonly listeners = new Set<RuntimeConfigListener>();
  private readonly baseline: RuntimeConfigValues;
  private readonly source: RuntimeConfigDocumentSource | null;
  private snapshot: RuntimeConfigSnapshot;
  private seq = 0;
  private stopWatching: (() => void) | null = null;

  constructor(
    @Optional()
    @Inject(RUNTIME_CONFIG_SOURCE)
    source?: RuntimeConfigDocumentSource | null,
  ) {
    this.source = source ?? null;
    this.baseline = buildRuntimeConfigBaseline();
    this.snapshot = {
      values: freezeRuntimeConfigValues(this.baseline),
      version: BASELINE_RUNTIME_CONFIG_VERSION,
      source: 'env',
      revision: null,
      seq: 0,
    };
  }

  /**
   * Reads the published document once, then subscribes to pushes. Runs only
   * when a source is configured — with `RNACOS_ENABLED` unset there is no
   * source, so this is a no-op and no native module is loaded.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (this.source === null) {
      return;
    }

    const loaded = await this.source.load();
    if (!loaded.ok) {
      this.logger.warn(
        `Runtime config center load failed (${loaded.reason}): ${loaded.message}`,
      );
    } else if (loaded.document === null) {
      this.logger.warn(
        'Runtime config center has no document at the configured dataId; using the environment baseline',
      );
    } else {
      this.applyDocumentFrom(loaded.document.content, loaded.document.origin);
    }

    const watching = await this.source.watch((document) => {
      this.applyDocumentFrom(document.content, document.origin);
    });
    if (!watching.ok) {
      this.logger.warn(
        `Runtime config center subscription failed (${watching.reason}): ${watching.message}`,
      );
      return;
    }
    this.stopWatching = watching.stop;
  }

  /** Stops dispatching pushes and releases the source's local state. */
  async onModuleDestroy(): Promise<void> {
    this.stopWatching?.();
    this.stopWatching = null;
    await this.source?.close();
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
    this.logPromptFingerprints(parsed.overrides);
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
   * Records which prompt revisions the document put in force, as digests.
   *
   * An operator can tell two revisions apart from the log, while the prompt
   * body — model instructions, possibly user-influenced wording — never reaches
   * log storage.
   */
  private logPromptFingerprints(overrides: Partial<RuntimeConfigValues>): void {
    const active: string[] = [];
    for (const key of RUNTIME_PROMPT_KEYS) {
      const text = overrides[key];
      if (typeof text === 'string') {
        active.push(`${key}=${fingerprintPrompt(text)}`);
      }
    }
    if (active.length > 0) {
      this.logger.debug(`Prompt overrides in force: ${active.join(', ')}`);
    }
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
