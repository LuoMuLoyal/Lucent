import { Logger } from '@nestjs/common';
import { EnvKey } from '../env/env-keys.enum.js';
import { fingerprintPrompt } from './prompt-registry.js';
import type {
  RuntimeConfigDocument,
  RuntimeConfigDocumentSource,
  RuntimeConfigLoadOutcome,
  RuntimeConfigWatchOutcome,
} from './runtime-config-source.js';
import { RuntimeConfigService } from './runtime-config.service.js';
import type { RuntimeConfigSnapshot } from './runtime-config.types.js';

const HEADER = 'RNACOS_SCHEMA_VERSION=3\nRNACOS_REVISION=test.1\n';

const MANAGED_KEYS = [
  EnvKey.THROTTLE_LIMIT,
  EnvKey.AI_VISION_TEMPERATURE,
  EnvKey.AI_THINKING,
  EnvKey.AI_VISION_THINKING,
  EnvKey.JWT_ACCESS_TTL,
  EnvKey.LIGHTRAG_GRAPH_SOURCES,
  EnvKey.MEDICINES_SEARCH_CACHE_TTL_MS,
];

function withEnv(values: Partial<Record<EnvKey, string>>): () => void {
  const saved = new Map<string, string | undefined>();
  for (const key of MANAGED_KEYS) {
    saved.set(key, process.env[key]);
    Reflect.deleteProperty(process.env, key);
  }
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  };
}

function sortedChanged(result: unknown): string[] {
  const changed = (result as { changed: readonly string[] }).changed;
  return [...changed].sort();
}

describe('RuntimeConfigService', () => {
  let restoreEnv: () => void = () => undefined;

  afterEach(() => {
    restoreEnv();
  });

  describe('baseline', () => {
    it('starts from the environment and labels itself env#0', () => {
      restoreEnv = withEnv({ [EnvKey.THROTTLE_LIMIT]: '250' });
      const service = new RuntimeConfigService();
      const snapshot = service.getSnapshot();

      expect(snapshot.values[EnvKey.THROTTLE_LIMIT]).toBe(250);
      expect(snapshot.version).toBe('env#0');
      expect(snapshot.source).toBe('env');
      expect(snapshot.revision).toBeNull();
      expect(service.getVersion()).toBe('env#0');
    });

    it('falls back to the code defaults when the environment is silent', () => {
      restoreEnv = withEnv({});
      const service = new RuntimeConfigService();

      expect(service.getSnapshot().values[EnvKey.THROTTLE_LIMIT]).toBe(100);
      expect(service.getSnapshot().values[EnvKey.AI_VISION_TEMPERATURE]).toBe(
        0.1,
      );
      expect(
        service.getSnapshot().values[EnvKey.MEDICINES_SEARCH_CACHE_TTL_MS],
      ).toBe(300_000);
    });

    it('inherits the global thinking mode when the role has no override', () => {
      restoreEnv = withEnv({ [EnvKey.AI_THINKING]: 'disabled' });
      const service = new RuntimeConfigService();

      // `AI_THINKING` is not itself a document key (each role carries its own);
      // it only shapes the baseline the roles inherit.
      expect(service.getSnapshot().values[EnvKey.AI_VISION_THINKING]).toBe(
        'disabled',
      );
    });

    it('prefers the role-level thinking override over the global default', () => {
      restoreEnv = withEnv({
        [EnvKey.AI_THINKING]: 'disabled',
        [EnvKey.AI_VISION_THINKING]: 'enabled',
      });
      const service = new RuntimeConfigService();

      expect(service.getSnapshot().values[EnvKey.AI_VISION_THINKING]).toBe(
        'enabled',
      );
    });
  });

  describe('applyDocument', () => {
    it('applies a valid document atomically and reports the changed keys', () => {
      restoreEnv = withEnv({});
      const service = new RuntimeConfigService();

      const result = service.applyDocument(
        `${HEADER}THROTTLE_LIMIT=120\nAI_VISION_TEMPERATURE=0.3\n`,
      );

      expect(result).toEqual(
        expect.objectContaining({ ok: true, version: 'test.1#1' }),
      );
      expect(sortedChanged(result)).toEqual([
        EnvKey.AI_VISION_TEMPERATURE,
        EnvKey.THROTTLE_LIMIT,
      ]);
      expect(service.getSnapshot().values[EnvKey.THROTTLE_LIMIT]).toBe(120);
      expect(service.getSnapshot().values[EnvKey.AI_VISION_TEMPERATURE]).toBe(
        0.3,
      );
      expect(service.getSnapshot().source).toBe('remote');
      expect(service.getSnapshot().revision).toBe('test.1');
    });

    it('keeps baseline values for keys the document omits or leaves blank', () => {
      restoreEnv = withEnv({ [EnvKey.THROTTLE_LIMIT]: '250' });
      const service = new RuntimeConfigService();

      const result = service.applyDocument(
        `${HEADER}AI_VISION_TEMPERATURE=\nMEDICINES_SEARCH_CACHE_TTL_MS=600000\n`,
      );

      expect(result.ok).toBe(true);
      const values = service.getSnapshot().values;
      expect(values[EnvKey.THROTTLE_LIMIT]).toBe(250);
      expect(values[EnvKey.AI_VISION_TEMPERATURE]).toBe(0.1);
      expect(values[EnvKey.MEDICINES_SEARCH_CACHE_TTL_MS]).toBe(600_000);
    });

    it('merges each document onto the environment baseline, not onto the previous document', () => {
      restoreEnv = withEnv({ [EnvKey.THROTTLE_LIMIT]: '250' });
      const service = new RuntimeConfigService();

      service.applyDocument(`${HEADER}THROTTLE_LIMIT=120\n`);
      const second = service.applyDocument(
        'RNACOS_SCHEMA_VERSION=3\nRNACOS_REVISION=test.2\nAI_VISION_TEMPERATURE=0.5\n',
      );

      expect(second).toEqual(
        expect.objectContaining({ ok: true, version: 'test.2#2' }),
      );
      expect(sortedChanged(second)).toEqual([
        EnvKey.AI_VISION_TEMPERATURE,
        EnvKey.THROTTLE_LIMIT,
      ]);
      // The key the new document drops falls back to the baseline value —
      // the environment's — not to the previous document's value.
      expect(service.getSnapshot().values[EnvKey.THROTTLE_LIMIT]).toBe(250);
      expect(service.getSnapshot().values[EnvKey.AI_VISION_TEMPERATURE]).toBe(
        0.5,
      );
    });

    it('drops a key from the document back to the baseline on the next apply', () => {
      restoreEnv = withEnv({});
      const service = new RuntimeConfigService();

      service.applyDocument(`${HEADER}THROTTLE_LIMIT=120\n`);
      service.applyDocument(`${HEADER}AI_VISION_TEMPERATURE=0.5\n`);

      expect(service.getSnapshot().values[EnvKey.THROTTLE_LIMIT]).toBe(100);
    });

    it('keeps the previous snapshot and version when a document is rejected', () => {
      restoreEnv = withEnv({});
      const service = new RuntimeConfigService();
      service.applyDocument(`${HEADER}THROTTLE_LIMIT=120\n`);
      const before = service.getSnapshot();

      for (const raw of [
        'THROTTLE_LIMIT 120',
        `${HEADER}THROTTLE_LIMIT=120\nTHROTTLE_LIMIT=130\n`,
        `${HEADER}JWT_ACCESS_SECRET=x`,
        `${HEADER}THROTTLE_LIMIT=0\n`,
        'RNACOS_SCHEMA_VERSION=1\nRNACOS_REVISION=test.9\nTHROTTLE_LIMIT=130\n',
      ]) {
        const result = service.applyDocument(raw);
        expect(result.ok).toBe(false);
      }

      expect(service.getSnapshot()).toBe(before);
      expect(service.getVersion()).toBe('test.1#1');
    });

    it('records the source the adapter reports', () => {
      restoreEnv = withEnv({});
      const service = new RuntimeConfigService();

      service.applyDocumentFrom(`${HEADER}THROTTLE_LIMIT=120\n`, 'local-cache');

      expect(service.getSnapshot().source).toBe('local-cache');
    });

    it('logs prompt revisions as fingerprints, never the prompt body', () => {
      restoreEnv = withEnv({});
      const service = new RuntimeConfigService();
      const body =
        'You are a test assistant. Tools: {{tools}}. {{toolAvailability}}';
      const debug = vi.spyOn(Logger.prototype, 'debug');
      const result = service.applyDocument(
        `${HEADER}PROMPT_ASSISTANT_SYSTEM=${body}`,
      );
      // Read the calls before restoring: mockRestore() also clears them.
      const logged = debug.mock.calls.flat().join(' ');
      debug.mockRestore();

      expect(result.ok).toBe(true);
      expect(logged).toContain(EnvKey.PROMPT_ASSISTANT_SYSTEM);
      expect(logged).toContain(fingerprintPrompt(body));
      expect(logged).not.toContain('You are a test assistant');
    });

    it('freezes the published snapshot, including list values', () => {
      restoreEnv = withEnv({});
      const service = new RuntimeConfigService();
      const values = service.getSnapshot().values as Record<string, unknown>;

      expect(Object.isFrozen(values)).toBe(true);
      expect(Object.isFrozen(values[EnvKey.LIGHTRAG_GRAPH_SOURCES])).toBe(true);
      expect(() => {
        values[EnvKey.THROTTLE_LIMIT] = 5;
      }).toThrow(TypeError);
    });
  });

  describe('subscribe', () => {
    it('notifies listeners only after a document validates', () => {
      restoreEnv = withEnv({});
      const service = new RuntimeConfigService();
      const seen: RuntimeConfigSnapshot[] = [];
      const unsubscribe = service.subscribe((snapshot) => {
        seen.push(snapshot);
      });

      service.applyDocument(`${HEADER}THROTTLE_LIMIT=0\n`);
      expect(seen).toHaveLength(0);

      service.applyDocument(`${HEADER}THROTTLE_LIMIT=120\n`);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.version).toBe('test.1#1');

      unsubscribe();
      service.applyDocument(`${HEADER}THROTTLE_LIMIT=130\n`);
      expect(seen).toHaveLength(1);
    });

    it('keeps notifying the other listeners when one throws', () => {
      restoreEnv = withEnv({});
      const service = new RuntimeConfigService();
      const seen: string[] = [];
      service.subscribe(() => {
        throw new Error('listener exploded');
      });
      service.subscribe((snapshot) => {
        seen.push(snapshot.version);
      });

      const result = service.applyDocument(`${HEADER}THROTTLE_LIMIT=120\n`);

      expect(result.ok).toBe(true);
      expect(seen).toEqual(['test.1#1']);
    });
  });

  describe('document source lifecycle', () => {
    interface FakeSource {
      readonly source: RuntimeConfigDocumentSource;
      readonly pushed: (document: RuntimeConfigDocument) => void;
      readonly closed: () => boolean;
      readonly stopped: () => boolean;
      readonly watchCalls: () => number;
    }

    function fakeSource(
      load: RuntimeConfigLoadOutcome,
      subscription?: RuntimeConfigWatchOutcome,
    ): FakeSource {
      const watching: RuntimeConfigWatchOutcome = subscription ?? {
        ok: true,
        stop: () => undefined,
      };
      let onDocument: ((document: RuntimeConfigDocument) => void) | null = null;
      let closed = false;
      let stopped = false;
      let watchCalls = 0;

      return {
        source: {
          load: () => Promise.resolve(load),
          watch: (listener) => {
            watchCalls += 1;
            if (!watching.ok) {
              return Promise.resolve(watching);
            }
            onDocument = listener;
            return Promise.resolve({
              ok: true,
              stop: () => {
                stopped = true;
              },
            });
          },
          close: () => {
            closed = true;
            return Promise.resolve();
          },
        },
        pushed: (document) => {
          if (stopped) {
            return;
          }
          onDocument?.(document);
        },
        closed: () => closed,
        stopped: () => stopped,
        watchCalls: () => watchCalls,
      };
    }

    it('applies the published document and then every push', async () => {
      restoreEnv = withEnv({});
      const fake = fakeSource({
        ok: true,
        document: {
          content: `${HEADER}THROTTLE_LIMIT=120\n`,
          origin: 'remote',
        },
      });
      const service = new RuntimeConfigService(fake.source);

      await service.onApplicationBootstrap();
      expect(service.getSnapshot().version).toBe('test.1#1');
      expect(service.getSnapshot().source).toBe('remote');

      fake.pushed({
        content:
          'RNACOS_SCHEMA_VERSION=3\nRNACOS_REVISION=test.2\nTHROTTLE_LIMIT=130\n',
        origin: 'remote',
      });
      expect(service.getSnapshot().version).toBe('test.2#2');
      expect(service.getSnapshot().values[EnvKey.THROTTLE_LIMIT]).toBe(130);
    });

    it('stays on the baseline when the center has no document or fails', async () => {
      restoreEnv = withEnv({ [EnvKey.THROTTLE_LIMIT]: '250' });

      const empty = new RuntimeConfigService(
        fakeSource({ ok: true, document: null }).source,
      );
      await expect(empty.onApplicationBootstrap()).resolves.toBeUndefined();
      expect(empty.getSnapshot().version).toBe('env#0');
      expect(empty.getSnapshot().values[EnvKey.THROTTLE_LIMIT]).toBe(250);

      const broken = new RuntimeConfigService(
        fakeSource({
          ok: false,
          reason: 'unreachable',
          message: 'connection refused',
        }).source,
      );
      await expect(broken.onApplicationBootstrap()).resolves.toBeUndefined();
      expect(broken.getSnapshot().source).toBe('env');

      const unwatchable = new RuntimeConfigService(
        fakeSource(
          { ok: true, document: null },
          { ok: false, reason: 'unreachable', message: 'stream closed' },
        ).source,
      );
      await expect(
        unwatchable.onApplicationBootstrap(),
      ).resolves.toBeUndefined();
      expect(unwatchable.getSnapshot().version).toBe('env#0');
    });

    it('stops dispatching and closes the source on destroy', async () => {
      restoreEnv = withEnv({});
      const fake = fakeSource({
        ok: true,
        document: {
          content: `${HEADER}THROTTLE_LIMIT=120\n`,
          origin: 'remote',
        },
      });
      const service = new RuntimeConfigService(fake.source);
      await service.onApplicationBootstrap();

      await service.onModuleDestroy();
      fake.pushed({
        content:
          'RNACOS_SCHEMA_VERSION=3\nRNACOS_REVISION=test.9\nTHROTTLE_LIMIT=999\n',
        origin: 'remote',
      });

      expect(fake.stopped()).toBe(true);
      expect(fake.closed()).toBe(true);
      expect(service.getSnapshot().version).toBe('test.1#1');
    });

    it('touches nothing without a source', async () => {
      restoreEnv = withEnv({});
      const service = new RuntimeConfigService(null);

      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(service.getSnapshot().source).toBe('env');
    });

    it('marks a cached document as local-cache', async () => {
      restoreEnv = withEnv({});
      const fake = fakeSource({
        ok: true,
        document: {
          content: `${HEADER}THROTTLE_LIMIT=120\n`,
          origin: 'local-cache',
        },
      });
      const service = new RuntimeConfigService(fake.source);

      await service.onApplicationBootstrap();

      expect(service.getSnapshot().source).toBe('local-cache');
    });
  });
});
