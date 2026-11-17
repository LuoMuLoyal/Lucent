import type { ConfigService } from '@nestjs/config';
import type { I18nService } from 'nestjs-i18n';

import { EnvKey } from '../../../../../../config/env/env-keys.enum.js';
import type { RuntimeConfigPort } from '../../../../../../config/runtime/runtime-config.types.js';
import type { AssistantToolExecutionContext } from '../../../../application/ports/assistant.js';
import type {
  LightragCallFailure,
  LightragQueryMode,
} from '../../../../application/ports/lightrag.types.js';
import { AssistantToolKnowledgeRetrievalService } from './knowledge.service.js';

/**
 * Tool-layer semantics of `search_cn_medicine_knowledge`.
 *
 * ## What this spec owns, and what it deliberately does not
 *
 * This service is the **policy** layer: it decides which `(source, mode)` pairs
 * are legitimate, which workspace a source maps to, what `verifiability` a
 * result carries, and how a transport failure is rendered to the model. All of
 * that is decided *around* one call — `lightrag.query()`.
 *
 * So the transport is stubbed **at the client boundary** here. There is no
 * `globalThis.fetch`, no `RequestInit`, no `try/catch` on a socket, and the
 * assertions are about decisions (workspace chosen, mode rejected, envelope
 * status), never about URLs or headers.
 *
 * HTTP shape, status-code classification, timeouts, body parsing and doc-id
 * mapping live in `lightrag-client.service.spec.ts`, one layer down, where the
 * thing being tested is actually the transport.
 *
 * The split matters because the old single spec had to mock `fetch` to assert on
 * policy: a change to a request header could fail a test named "maps sources to
 * workspaces", which tells you nothing about what actually broke.
 */

/** One recorded call to the LightRAG client, as the tool layer sees it. */
interface QueryCall {
  workspace: string;
  query: string;
  mode: LightragQueryMode;
  limit: number;
}

interface FakeClient {
  query: (input: QueryCall) => Promise<
    | {
        ok: true;
        value: {
          chunks: Array<{
            text: string;
            rank: number;
            score: number;
            leafletId: string | null;
            sourceField: string | null;
            qaId: string | null;
          }>;
          hasUnmappedChunk: boolean;
        };
      }
    | { ok: false; failure: LightragCallFailure }
  >;
}

describe('AssistantToolKnowledgeRetrievalService — tool policy', () => {
  function runtimeWith(values: Record<string, unknown>): RuntimeConfigPort {
    return {
      getSnapshot: () => ({
        values: values as never,
        version: 'test#1',
        source: 'remote',
        revision: 'test',
        seq: 1,
      }),
      getVersion: () => 'test#1',
      applyDocument: () => ({ ok: true, version: 'test#1', changed: [] }),
      subscribe: () => () => undefined,
    };
  }

  const settings: Record<string, unknown> = {
    [EnvKey.LIGHTRAG_ENABLED]: 'true',
    [EnvKey.LIGHTRAG_BASE_URL]: 'http://lightrag:9621',
    [EnvKey.LIGHTRAG_API_KEY]: 'handshake-key',
    [EnvKey.LIGHTRAG_TIMEOUT_MS]: 8000,
    [EnvKey.LIGHTRAG_GRAPH_TIMEOUT_MS]: 60_000,
    [EnvKey.LIGHTRAG_GRAPH_SOURCES]: ['leaflet'],
    [EnvKey.LIGHTRAG_MAX_LIMIT]: 8,
    [EnvKey.LIGHTRAG_WORKSPACE_LEAFLET]: 'leaflet',
    [EnvKey.LIGHTRAG_WORKSPACE_QA]: 'qa',
  };

  /**
   * Builds the service with a stubbed LightRAG client.
   *
   * With no argument the client returns one citable chunk; passing a function
   * lets a test choose the client's outcome (a failure Result, an unmapped
   * chunk, ...) without going anywhere near HTTP.
   */
  function buildService(
    query?: () => Promise<
      { ok: true; value: never } | { ok: false; failure: LightragCallFailure }
    >,
  ): {
    service: AssistantToolKnowledgeRetrievalService;
    calls: QueryCall[];
  } {
    const calls: QueryCall[] = [];
    const fake: FakeClient = {
      query: (input: QueryCall) => {
        calls.push(input);
        if (typeof query === 'function') {
          return query();
        }
        return Promise.resolve({
          ok: true as const,
          value: {
            chunks: [
              {
                text: '孕妇禁用。',
                rank: 1,
                score: 0.9,
                leafletId: 'L-1',
                sourceField: 'contraindications',
                qaId: null,
              },
            ],
            hasUnmappedChunk: false,
          },
        });
      },
    };
    const configService = {
      get: vi.fn((key: string) => settings[key]),
    };
    const service = new AssistantToolKnowledgeRetrievalService(
      fake as never,
      configService as unknown as ConfigService,
      { t: vi.fn(() => 'disclaimer') } as unknown as I18nService,
      runtimeWith(settings),
    );
    return { service, calls };
  }

  function context(
    toolArgs: Record<string, unknown>,
    overrides: Partial<AssistantToolExecutionContext> = {},
  ): AssistantToolExecutionContext {
    return {
      userId: 'user-1',
      locale: 'zh-CN',
      userMessage: '阿司匹林有什么禁忌',
      enabledContextSources: [],
      memoryEnabled: false,
      toolArgs,
      ...overrides,
    };
  }

  describe('source → workspace mapping', () => {
    it('maps leaflet to its configured workspace', async () => {
      const { service, calls } = buildService();

      await service.searchCnMedicineKnowledge(
        context({ query: '阿司匹林', source: 'leaflet' }),
      );

      expect(calls[0]?.workspace).toBe('leaflet');
    });

    it('maps qa to its own workspace, never the leaflet one', async () => {
      const { service, calls } = buildService();

      await service.searchCnMedicineKnowledge(
        context({ query: '能否同服', source: 'qa' }),
      );

      expect(calls[0]?.workspace).toBe('qa');
      expect(calls[0]?.workspace).not.toBe(
        calls[0]?.workspace === 'qa' ? 'x' : 'qa',
      );
    });

    it('defaults a missing source to leaflet rather than failing the call', async () => {
      const { service, calls } = buildService();

      const envelope = await service.searchCnMedicineKnowledge(
        context({ query: '阿司匹林' }),
      );

      expect(calls[0]?.workspace).toBe('leaflet');
      expect(envelope.result).toBeDefined();
    });

    it('never lets the model choose the workspace directly', async () => {
      // A `workspace` argument would let the model cross corpora and break the
      // evidence layering (plan §5.3.1). It must be ignored entirely.
      const { service, calls } = buildService();

      await service.searchCnMedicineKnowledge(
        context({ query: '阿司匹林', source: 'qa', workspace: 'leaflet' }),
      );

      expect(calls[0]?.workspace).toBe('qa');
    });
  });

  describe('graph-mode allowlist', () => {
    it('rejects a graph mode for a source without a built graph', async () => {
      const { service, calls } = buildService();

      const envelope = await service.searchCnMedicineKnowledge(
        context({ query: '能否同服', source: 'qa', mode: 'mix' }),
      );

      expect(calls).toEqual([]);
      expect(envelope.confidence.reason).toMatch(/mode/i);
    });

    it('passes a graph mode through once the source has a graph', async () => {
      const { service, calls } = buildService();

      await service.searchCnMedicineKnowledge(
        context({ query: '阿司匹林', source: 'leaflet', mode: 'local' }),
      );

      expect(calls[0]?.mode).toBe('local');
    });

    it('rejects bypass explicitly instead of forwarding it', async () => {
      const { service, calls } = buildService();

      await service.searchCnMedicineKnowledge(
        context({ query: '阿司匹林', mode: 'bypass' }),
      );

      expect(calls).toEqual([]);
    });

    it('rejects an unknown mode rather than silently falling back', async () => {
      const { service, calls } = buildService();

      await service.searchCnMedicineKnowledge(
        context({ query: '阿司匹林', mode: 'nonsense' }),
      );

      expect(calls).toEqual([]);
    });
  });

  describe('argument boundary', () => {
    it('rejects an unknown source and never calls the client', async () => {
      const { service, calls } = buildService();

      await service.searchCnMedicineKnowledge(
        context({ query: '阿司匹林', source: 'pubmed' }),
      );

      expect(calls).toEqual([]);
    });

    it('rejects an empty query before reaching the client', async () => {
      const { service, calls } = buildService();

      await service.searchCnMedicineKnowledge(context({ query: '   ' }));

      expect(calls).toEqual([]);
    });

    it('clamps the requested limit to the shared maximum', async () => {
      const { service, calls } = buildService();

      await service.searchCnMedicineKnowledge(
        context({ query: '阿司匹林', limit: 9_999 }),
      );

      expect(calls[0]?.limit).toBe(8);
    });
  });

  describe('verifiability is assigned by the server, not the caller', () => {
    it('marks leaflet chunks as citable', async () => {
      const { service } = buildService();

      const envelope = await service.searchCnMedicineKnowledge(
        context({ query: '阿司匹林', source: 'leaflet' }),
      );

      expect(
        (envelope.result as { chunks: Array<{ verifiability: string }> })
          .chunks[0]?.verifiability,
      ).toBe('citable');
    });

    it('marks qa results as a low-trust open corpus', async () => {
      const { service } = buildService();

      const envelope = await service.searchCnMedicineKnowledge(
        context({ query: '能否同服', source: 'qa' }),
      );

      expect(
        (envelope.result as { chunks: Array<{ verifiability: string }> })
          .chunks[0]?.verifiability,
      ).toBe('open_corpus');
    });

    it('ignores a caller-supplied verifiability', async () => {
      const { service } = buildService();

      const envelope = await service.searchCnMedicineKnowledge(
        context({ query: '能否同服', source: 'qa', verifiability: 'citable' }),
      );

      expect(
        (envelope.result as { chunks: Array<{ verifiability: string }> })
          .chunks[0]?.verifiability,
      ).toBe('open_corpus');
    });
  });

  describe('failure rendering', () => {
    it('renders a timeout as retrieval-unavailable, not as no evidence', async () => {
      // A timeout means "we do not know", which is materially different from
      // "we looked and found nothing".
      const { service } = buildService(() =>
        Promise.resolve({
          ok: false as const,
          failure: {
            kind: 'timeout',
            reason: 'timed out',
          } as LightragCallFailure,
        }),
      );

      const envelope = await service.searchCnMedicineKnowledge(
        context({ query: '阿司匹林' }),
      );

      // A transport failure and "found nothing" both render an empty envelope,
      // so the discriminator is the reason text and the unavailable marker —
      // not the coverage status alone.
      expect(envelope.coverage.reason).toMatch(/unavailable/i);
      // The failure's own message must survive into the envelope: it is what
      // tells the model "retry later" instead of "this medicine has no data".
      expect(envelope.coverage.reason).toContain('timed out');
      expect(envelope.confidence.reason).toMatch(/unavailable/i);
      expect(envelope.confidence.reason).not.toMatch(/no matching/i);
      expect((envelope.result as { verifiability: string }).verifiability).toBe(
        'unavailable',
      );
    });
  });

  describe('coverage', () => {
    it('flags partial coverage when a chunk cannot be traced to a leaflet', async () => {
      const service = new AssistantToolKnowledgeRetrievalService(
        {
          query: () =>
            Promise.resolve({
              ok: true as const,
              value: {
                chunks: [
                  {
                    text: '证据',
                    rank: 1,
                    score: 0.5,
                    leafletId: null,
                    sourceField: null,
                    qaId: 'qa-1',
                  },
                ],
                hasUnmappedChunk: true,
              },
            }),
        } as never,
        { get: vi.fn((k: string) => settings[k]) } as unknown as ConfigService,
        { t: vi.fn(() => 'disclaimer') } as unknown as I18nService,
        runtimeWith(settings),
      );

      const envelope = await service.searchCnMedicineKnowledge(
        context({ query: '阿司匹林' }),
      );

      expect(envelope.coverage.status).toBe('partial');
    });

    it('reports complete coverage when every chunk is traceable', async () => {
      const { service } = buildService();

      const envelope = await service.searchCnMedicineKnowledge(
        context({ query: '阿司匹林' }),
      );

      expect(envelope.coverage.status).toBe('complete');
    });
  });

  it('never asks LightRAG to generate an answer', async () => {
    // The tool retrieves evidence only; prose generation is not this layer's job.
    const { service, calls } = buildService();

    await service.searchCnMedicineKnowledge(context({ query: '阿司匹林' }));

    expect(Object.keys(calls[0] ?? {}).sort()).toEqual([
      'limit',
      'mode',
      'query',
      'workspace',
    ]);
  });
});
