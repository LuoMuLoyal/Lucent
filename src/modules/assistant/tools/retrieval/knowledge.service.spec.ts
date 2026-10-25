import type { ConfigService } from '@nestjs/config';
import type { I18nService } from 'nestjs-i18n';

import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import type { RuntimeConfigPort } from '../../../../config/runtime/runtime-config.types.js';
import type { AssistantToolExecutionContext } from '../../types/assistant.types.js';
import { LightragClientService } from './lightrag-client.service.js';
import { AssistantToolKnowledgeRetrievalService } from './knowledge.service.js';

/**
 * End-to-end wiring of `search_cn_medicine_knowledge` through the real client.
 *
 * ## What is left here, and why
 *
 * Policy decisions (workspace mapping, graph-mode allowlist, verifiability,
 * empty-vs-failure rendering) are covered by `knowledge-policy.spec.ts` with the
 * LightRAG client stubbed; the transport itself (URL, headers, status classes,
 * timeouts, body parsing, doc-id mapping) by `lightrag-client.service.spec.ts`.
 *
 * Neither of those catches a **wiring** break: the tool builds a request the
 * client cannot send, or reads a field the client never sets. So this spec keeps
 * only the cases where the two layers must agree end to end, with `fetch` mocked
 * at the very bottom of the stack.
 *
 * Everything else that used to live here was a policy assertion that happened to
 * reach through HTTP — testing it that way meant a change to a request header
 * could fail a test named "maps sources to workspaces", which says nothing about
 * what broke. Those moved to the policy spec, where they fail for the reason
 * their title names.
 */

describe('AssistantToolKnowledgeRetrievalService — end-to-end wiring', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

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

  function buildService(): AssistantToolKnowledgeRetrievalService {
    const configService = { get: vi.fn((key: string) => settings[key]) };
    const client = new LightragClientService(
      configService as unknown as ConfigService,
      runtimeWith(settings),
    );
    return new AssistantToolKnowledgeRetrievalService(
      client,
      configService as unknown as ConfigService,
      { t: vi.fn(() => 'disclaimer') } as unknown as I18nService,
      runtimeWith(settings),
    );
  }

  function context(
    toolArgs: Record<string, unknown>,
  ): AssistantToolExecutionContext {
    return {
      userId: 'user-1',
      locale: 'zh-CN',
      userMessage: '阿司匹林有什么禁忌',
      enabledContextSources: [],
      memoryEnabled: false,
      toolArgs,
    };
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function leafletQueryResponse(): Response {
    return jsonResponse({
      response: 'context',
      references: [
        {
          reference_id: '1',
          file_path: 'leaflet:L-1:contraindications:0',
          content: ['孕妇禁用。'],
        },
      ],
    });
  }

  it('renders a real sidecar response into a citable envelope', async () => {
    // Wiring check: the client parses `references[]`; the tool maps `leafletId`
    // and `sourceField` into the envelope the model actually receives.
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(leafletQueryResponse()) as unknown as typeof fetch;

    const envelope = await buildService().searchCnMedicineKnowledge(
      context({ query: '阿司匹林', source: 'leaflet' }),
    );

    const result = envelope.result as {
      chunks: Array<{
        leafletId: string | null;
        sourceField: string | null;
        verifiability: string;
      }>;
    };
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.leafletId).toBe('L-1');
    expect(result.chunks[0]?.sourceField).toBe('contraindications');
    expect(result.chunks[0]?.verifiability).toBe('citable');
    expect(envelope.coverage.status).toBe('complete');
  });

  it('carries the workspace the tool chose down to the request header', async () => {
    // The one place both layers must agree on a *value*: the tool picks the
    // workspace, the client puts it on the wire as `X-Workspace`.
    const fetchMock = vi.fn().mockResolvedValue(leafletQueryResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await buildService().searchCnMedicineKnowledge(
      context({ query: '能否同服', source: 'qa' }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get('LIGHTRAG-WORKSPACE')).toBe('qa');
  });

  it('separates an empty result from a transport failure end to end', async () => {
    // Both look "empty" to a caller that only counts chunks; the envelope must
    // keep them distinguishable all the way through the real client.
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ response: 'context', references: [] }),
      ) as unknown as typeof fetch;
    const empty = await buildService().searchCnMedicineKnowledge(
      context({ query: '阿司匹林' }),
    );

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: 'boom' }, 500),
      ) as unknown as typeof fetch;
    const failed = await buildService().searchCnMedicineKnowledge(
      context({ query: '阿司匹林' }),
    );

    expect(empty.result).not.toEqual(failed.result);
    expect(empty.coverage.reason).not.toBe(failed.coverage.reason);
  });
});
