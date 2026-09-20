import type { ConfigService } from '@nestjs/config';
import type { I18nService } from 'nestjs-i18n';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import type { AssistantToolExecutionContext } from '../../types/assistant.types.js';
import { LightragClientService } from './lightrag-client.service.js';
import { AssistantToolKnowledgeRetrievalService } from './knowledge.service.js';

describe('AssistantToolKnowledgeRetrievalService', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function buildService(envOverrides?: Record<string, unknown>) {
    const values: Record<string, unknown> = {
      [EnvKey.LIGHTRAG_ENABLED]: 'true',
      [EnvKey.LIGHTRAG_BASE_URL]: 'http://lightrag:9621',
      [EnvKey.LIGHTRAG_API_KEY]: 'handshake-key',
      [EnvKey.LIGHTRAG_TIMEOUT_MS]: 8000,
      [EnvKey.LIGHTRAG_GRAPH_TIMEOUT_MS]: 60_000,
      // 与 `LIGHTRAG_DEFAULT_GRAPH_SOURCES` 一致：说明书侧的图是建好的。
      [EnvKey.LIGHTRAG_GRAPH_SOURCES]: 'leaflet',
      [EnvKey.LIGHTRAG_WORKSPACE_LEAFLET]: 'leaflet',
      [EnvKey.LIGHTRAG_WORKSPACE_QA]: 'qa',
      ...envOverrides,
    };
    const configService = {
      get: vi.fn((key: string) => values[key]),
    };
    const i18n = {
      t: vi.fn(() => 'disclaimer'),
    };
    const client = new LightragClientService(
      configService as unknown as ConfigService,
    );
    return new AssistantToolKnowledgeRetrievalService(
      client,
      configService as unknown as ConfigService,
      i18n as unknown as I18nService,
    );
  }

  function buildContext(
    args: Record<string, unknown>,
    overrides?: Partial<AssistantToolExecutionContext>,
  ): AssistantToolExecutionContext {
    return {
      userId: 'user-1',
      locale: 'zh-CN',
      userMessage: '阿司匹林有什么禁忌',
      enabledContextSources: [],
      memoryEnabled: false,
      toolArgs: args,
      ...overrides,
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

  it('returns leaflet chunks with provenance and citable verifiability', async () => {
    const fetchMock = vi.fn().mockResolvedValue(leafletQueryResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const envelope = await buildService().searchCnMedicineKnowledge(
      buildContext({ query: '阿司匹林的禁忌', source: 'leaflet' }),
    );

    expect(envelope.source.tool).toBe('search_cn_medicine_knowledge');
    expect(envelope.coverage).toEqual({ status: 'complete', reason: null });
    const result = envelope.result as {
      chunks: Record<string, unknown>[];
      source: string;
      mode: string;
    };
    expect(result.source).toBe('leaflet');
    expect(result.mode).toBe('naive');
    expect(result.chunks).toEqual([
      expect.objectContaining({
        text: '孕妇禁用。',
        rank: 1,
        leafletId: 'L-1',
        sourceField: 'contraindications',
        verifiability: 'citable',
      }),
    ]);
    expect(envelope.source.tables).toEqual(['leaflet:lightrag_chunks']);
  });

  it('marks qa results as a low-trust open corpus', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        response: 'context',
        references: [
          {
            reference_id: '1',
            file_path: 'qa:Q-1:general:0',
            content: ['高血压需要长期管理。'],
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const envelope = await buildService().searchCnMedicineKnowledge(
      buildContext({ query: '高血压怎么预防', source: 'qa' }),
    );

    const result = envelope.result as { chunks: Record<string, unknown>[] };
    expect(result.chunks[0]).toMatchObject({
      verifiability: 'open_corpus',
      sourceNote: '开放语料,低可信教育参考,无独立可验证来源',
    });
  });

  it('routes each source to its own workspace and never mixes them', async () => {
    const fetchMock = vi.fn().mockResolvedValue(leafletQueryResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await buildService().searchCnMedicineKnowledge(
      buildContext({ query: '问题', source: 'qa' }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'LIGHTRAG-WORKSPACE': 'qa' });
  });

  it('flags partial coverage when a chunk cannot be traced to a leaflet', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        response: 'context',
        references: [
          {
            reference_id: '1',
            file_path: 'unknown-source.pdf',
            content: ['正文'],
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const envelope = await buildService().searchCnMedicineKnowledge(
      buildContext({ query: '问题', source: 'leaflet' }),
    );

    expect(envelope.coverage.status).toBe('partial');
    expect(envelope.confidence.level).toBe('medium');
  });

  it('returns an empty envelope when the sidecar finds no evidence', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ response: '', references: [] }),
      ) as unknown as typeof fetch;

    const envelope = await buildService().searchCnMedicineKnowledge(
      buildContext({ query: '不存在的药', source: 'leaflet' }),
    );

    expect(envelope.coverage.status).toBe('empty');
    expect(envelope.coverage.reason).toContain('No relevant');
    expect(envelope.confidence.level).toBe('low');
  });

  it('reports an empty envelope without calling the sidecar when disabled', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const envelope = await buildService({
      [EnvKey.LIGHTRAG_ENABLED]: 'false',
    }).searchCnMedicineKnowledge(
      buildContext({ query: '阿司匹林', source: 'leaflet' }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(envelope.coverage.status).toBe('empty');
    expect(envelope.coverage.reason).toContain('not configured');
    const result = envelope.result as { verifiability: string };
    expect(result.verifiability).toBe('unavailable');
  });

  it('surfaces a timeout as retrieval-unavailable rather than no evidence', async () => {
    const timeoutError = new Error('The operation was aborted');
    timeoutError.name = 'TimeoutError';
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(timeoutError) as unknown as typeof fetch;

    const envelope = await buildService().searchCnMedicineKnowledge(
      buildContext({ query: '阿司匹林', source: 'leaflet' }),
    );

    expect(envelope.coverage.status).toBe('empty');
    expect(envelope.coverage.reason).toContain('unavailable');
    expect(envelope.coverage.reason).toContain('timed out');
    expect(envelope.coverage.reason).not.toContain('No relevant');
  });

  it('surfaces a 4xx as retrieval-unavailable', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('bad request', { status: 400 }),
      ) as unknown as typeof fetch;

    const envelope = await buildService().searchCnMedicineKnowledge(
      buildContext({ query: '阿司匹林', source: 'leaflet' }),
    );

    expect(envelope.coverage.reason).toContain('unavailable');
    expect(envelope.coverage.reason).toContain(
      'rejected the retrieval request',
    );
  });

  it('surfaces a 5xx as retrieval-unavailable', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('boom', { status: 503 }),
      ) as unknown as typeof fetch;

    const envelope = await buildService().searchCnMedicineKnowledge(
      buildContext({ query: '阿司匹林', source: 'leaflet' }),
    );

    expect(envelope.coverage.reason).toContain('unavailable');
    expect(envelope.coverage.reason).toContain('failed');
  });

  it('rejects an unknown source before calling the sidecar', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const envelope = await buildService().searchCnMedicineKnowledge(
      buildContext({ query: '阿司匹林', source: 'drugbank' }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(envelope.coverage.reason).toContain('"source" must be one of');
  });

  it('rejects an empty query before calling the sidecar', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const envelope = await buildService().searchCnMedicineKnowledge(
      buildContext({ query: '   ', source: 'leaflet' }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(envelope.coverage.reason).toContain('"query" must not be empty');
  });

  it('rejects "mix" for the qa workspace', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const envelope = await buildService().searchCnMedicineKnowledge(
      buildContext({ query: '高血压', source: 'qa', mode: 'mix' }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(envelope.coverage.reason).toContain('requires a knowledge graph');
    expect(envelope.coverage.reason).toContain('"qa"');
  });

  it('passes a graph mode through once the source has a graph built', async () => {
    const fetchMock = vi.fn().mockResolvedValue(leafletQueryResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const envelope = await buildService().searchCnMedicineKnowledge(
      buildContext({ query: '阿司匹林', source: 'leaflet', mode: 'local' }),
    );

    expect(envelope.coverage.status).toBe('complete');
    const result = envelope.result as { mode: string };
    expect(result.mode).toBe('local');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // `request()` 把 body 序列化成 JSON 字符串；这里断言 mode 真的发到了线上，
    // 而不只是信封里回显了它。
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['mode']).toBe('local');
  });

  it('rejects graph modes for a source whose graph is not built', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // 空列表 = 没有任何来源建图，即回到"图模式全禁"。
    const envelope = await buildService({
      [EnvKey.LIGHTRAG_GRAPH_SOURCES]: '',
    }).searchCnMedicineKnowledge(
      buildContext({ query: '阿司匹林', source: 'leaflet', mode: 'local' }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(envelope.coverage.reason).toContain('requires a knowledge graph');
    expect(envelope.coverage.reason).toContain('"leaflet"');
  });

  it('rejects bypass mode explicitly', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const envelope = await buildService().searchCnMedicineKnowledge(
      buildContext({ query: '阿司匹林', source: 'leaflet', mode: 'bypass' }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(envelope.coverage.reason).toContain('"bypass" mode is not allowed');
  });

  it('rejects an unknown mode instead of silently falling back', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const envelope = await buildService().searchCnMedicineKnowledge(
      buildContext({ query: '阿司匹林', source: 'leaflet', mode: 'turbo' }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(envelope.coverage.reason).toContain('"mode" must be one of');
  });

  it('caps the requested limit at the shared maximum', async () => {
    const fetchMock = vi.fn().mockResolvedValue(leafletQueryResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await buildService().searchCnMedicineKnowledge(
      buildContext({ query: '阿司匹林', source: 'leaflet', limit: 99 }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['chunk_top_k']).toBe(8);
  });
});
