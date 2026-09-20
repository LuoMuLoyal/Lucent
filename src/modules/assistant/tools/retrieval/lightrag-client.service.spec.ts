import type { ConfigService } from '@nestjs/config';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import { LightragClientService } from './lightrag-client.service.js';

describe('LightragClientService', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function buildService(overrides?: Record<string, unknown>) {
    const values: Record<string, unknown> = {
      [EnvKey.LIGHTRAG_ENABLED]: 'true',
      [EnvKey.LIGHTRAG_BASE_URL]: 'http://lightrag:9621',
      [EnvKey.LIGHTRAG_API_KEY]: 'handshake-key',
      [EnvKey.LIGHTRAG_TIMEOUT_MS]: 8000,
      [EnvKey.LIGHTRAG_GRAPH_TIMEOUT_MS]: 60_000,
      ...overrides,
    };
    const configService = {
      get: vi.fn((key: string) => values[key]),
    };
    return new LightragClientService(configService as unknown as ConfigService);
  }

  it('gives graph modes a larger timeout budget than naive', () => {
    const service = buildService();

    // 图模式每次查询要现调 LLM 抽关键词再遍历图（实测 16–29 秒），
    // 8 秒的 naive 预算会把它们全部打成超时。
    expect(service.resolveTimeoutMs('naive')).toBe(8000);
    expect(service.resolveTimeoutMs('local')).toBe(60_000);
    expect(service.resolveTimeoutMs('global')).toBe(60_000);
    expect(service.resolveTimeoutMs('hybrid')).toBe(60_000);
    expect(service.resolveTimeoutMs('mix')).toBe(60_000);
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('reports disabled when LIGHTRAG_ENABLED is false', async () => {
    const service = buildService({ [EnvKey.LIGHTRAG_ENABLED]: 'false' });

    expect(service.isEnabled()).toBe(false);
    await expect(
      service.query({ workspace: 'leaflet', query: '阿司匹林禁忌', limit: 4 }),
    ).resolves.toEqual({
      ok: false,
      failure: {
        kind: 'disabled',
        reason: 'LightRAG retrieval is not configured.',
        status: null,
      },
    });
  });

  it('reports disabled when the API key is missing', () => {
    const service = buildService({ [EnvKey.LIGHTRAG_API_KEY]: '   ' });

    expect(service.isEnabled()).toBe(false);
  });

  it('returns chunks with leaflet provenance on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        response: 'context',
        references: [
          {
            reference_id: '1',
            file_path: 'leaflet:L-1:contraindications:0',
            content: ['孕妇禁用。', '对本品过敏者禁用。'],
          },
          {
            reference_id: '2',
            file_path: 'leaflet:L-2:adverse_reactions:3',
            content: ['偶见皮疹。'],
          },
        ],
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await buildService().query({
      workspace: 'leaflet',
      query: '阿司匹林禁忌',
      limit: 4,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.value.hasUnmappedChunk).toBe(false);
    expect(result.value.chunks).toEqual([
      {
        text: '孕妇禁用。',
        rank: 1,
        score: null,
        filePath: 'leaflet:L-1:contraindications:0',
        leafletId: 'L-1',
        sourceField: 'contraindications',
        qaId: null,
      },
      {
        text: '对本品过敏者禁用。',
        rank: 2,
        score: null,
        filePath: 'leaflet:L-1:contraindications:0',
        leafletId: 'L-1',
        sourceField: 'contraindications',
        qaId: null,
      },
      {
        text: '偶见皮疹。',
        rank: 3,
        score: null,
        filePath: 'leaflet:L-2:adverse_reactions:3',
        leafletId: 'L-2',
        sourceField: 'adverse_reactions',
        qaId: null,
      },
    ]);
  });

  it('never asks LightRAG to generate an answer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ response: '', references: [] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await buildService().query({
      workspace: 'qa',
      query: '高血压的预防',
      mode: 'naive',
      limit: 4,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['only_need_context']).toBe(true);
    expect(body['include_chunk_content']).toBe(true);
    expect(body['include_references']).toBe(true);
    expect(body['mode']).toBe('naive');
    expect(body['chunk_top_k']).toBe(4);
    // 实测校准：LightRAG 的 API key 走 X-API-Key，Authorization 是 OAuth2 登录令牌专用。
    // 发成 Bearer 会被判 401 "Invalid token"（不是"密钥不对"）。
    expect(init.headers).toMatchObject({
      'X-API-Key': 'handshake-key',
      'LIGHTRAG-WORKSPACE': 'qa',
    });
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('maps qa doc ids to qaId without treating them as unmapped', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        response: 'context',
        references: [
          {
            reference_id: '1',
            file_path: 'qa:QA-7:0',
            content: ['问：感冒怎么办？\n答：多休息。'],
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const result = await buildService().query({
      workspace: 'qa',
      query: '感冒',
      limit: 4,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    // qa 命中本来就没有说明书身份，不是溯源缺失。
    expect(result.value.hasUnmappedChunk).toBe(false);
    expect(result.value.chunks[0]?.qaId).toBe('QA-7');
    expect(result.value.chunks[0]?.leafletId).toBeNull();
  });

  it('flags chunks whose doc id cannot be mapped back to a leaflet', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        response: 'context',
        references: [
          { reference_id: '1', file_path: 'some-input.pdf', content: ['正文'] },
        ],
      }),
    ) as unknown as typeof fetch;

    const result = await buildService().query({
      workspace: 'leaflet',
      query: '问题',
      limit: 4,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.value.hasUnmappedChunk).toBe(true);
    expect(result.value.chunks[0]?.leafletId).toBeNull();
    expect(result.value.chunks[0]?.qaId).toBeNull();
  });

  it('returns an empty chunk list when the sidecar finds no evidence', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ response: '', references: [] }),
      ) as unknown as typeof fetch;

    const result = await buildService().query({
      workspace: 'leaflet',
      query: '问题',
      limit: 4,
    });

    expect(result).toEqual({
      ok: true,
      value: { chunks: [], hasUnmappedChunk: false },
    });
  });

  it('classifies a client timeout as timeout, not as empty evidence', async () => {
    const timeoutError = new Error('The operation was aborted');
    timeoutError.name = 'TimeoutError';
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(timeoutError) as unknown as typeof fetch;

    const result = await buildService().query({
      workspace: 'leaflet',
      query: '问题',
      limit: 4,
    });

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: 'timeout',
        reason: 'LightRAG retrieval timed out after 8000ms.',
        status: null,
      },
    });
  });

  it('classifies a connection failure as unreachable', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(
        new TypeError('fetch failed'),
      ) as unknown as typeof fetch;

    const result = await buildService().query({
      workspace: 'leaflet',
      query: '问题',
      limit: 4,
    });

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: 'unreachable',
        reason: 'LightRAG retrieval service is unreachable.',
        status: null,
      },
    });
  });

  it('classifies a 401 as an API-key rejection', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('unauthorized', { status: 401 }),
      ) as unknown as typeof fetch;

    const result = await buildService().query({
      workspace: 'leaflet',
      query: '问题',
      limit: 4,
    });

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: 'unauthorized',
        reason: 'LightRAG rejected the configured API key.',
        status: 401,
      },
    });
  });

  it('classifies a 422 as a rejected request', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('{"detail":[]}', { status: 422 }),
      ) as unknown as typeof fetch;

    const result = await buildService().query({
      workspace: 'leaflet',
      query: '问题',
      limit: 4,
    });

    expect(result).toMatchObject({
      ok: false,
      failure: { kind: 'bad_request', status: 422 },
    });
  });

  it('classifies a 500 as a server error', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('boom', { status: 500 }),
      ) as unknown as typeof fetch;

    const result = await buildService().query({
      workspace: 'leaflet',
      query: '问题',
      limit: 4,
    });

    expect(result).toMatchObject({
      ok: false,
      failure: { kind: 'server_error', status: 500 },
    });
  });

  it('classifies an unreadable body as malformed', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('<html>gateway</html>', { status: 200 }),
      ) as unknown as typeof fetch;

    const result = await buildService().query({
      workspace: 'leaflet',
      query: '问题',
      limit: 4,
    });

    expect(result).toMatchObject({
      ok: false,
      failure: { kind: 'malformed_response' },
    });
  });

  it('reports health as unavailable while disabled', async () => {
    const service = buildService({ [EnvKey.LIGHTRAG_ENABLED]: 'false' });

    await expect(service.health()).resolves.toEqual({
      ok: false,
      reason: 'LightRAG retrieval is not configured.',
    });
  });

  it('probes /health without a workspace header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(buildService().health()).resolves.toEqual({
      ok: true,
      reason: null,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://lightrag:9621/health');
    expect(init.method).toBe('GET');
    expect(init.headers).not.toHaveProperty('LIGHTRAG-WORKSPACE');
  });
});
