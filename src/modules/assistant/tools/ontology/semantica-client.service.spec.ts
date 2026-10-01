import type { ConfigService } from '@nestjs/config';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import { SemanticaClientService } from './semantica-client.service.js';

describe('SemanticaClientService', () => {
  const originalFetch = globalThis.fetch;

  /** 任意非空值：客户端只把它放进 Authorization，不做别的判断。 */
  const TEST_API_KEY = 'test-semantica-token';

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function buildService(overrides?: Record<string, unknown>) {
    const values: Record<string, unknown> = {
      [EnvKey.SEMANTICA_ENABLED]: 'true',
      [EnvKey.SEMANTICA_BASE_URL]: 'http://semantica:8099',
      [EnvKey.SEMANTICA_TIMEOUT_MS]: 20000,
      [EnvKey.SEMANTICA_API_KEY]: TEST_API_KEY,
      ...overrides,
    };
    const configService = {
      get: vi.fn((key: string) => values[key]),
    };
    return new SemanticaClientService(
      configService as unknown as ConfigService,
    );
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('reports disabled when SEMANTICA_ENABLED is false', async () => {
    const service = buildService({ [EnvKey.SEMANTICA_ENABLED]: 'false' });

    expect(service.isEnabled()).toBe(false);
    await expect(
      service.query({ cypher: 'MATCH (n) RETURN n', params: {}, limit: 10 }),
    ).resolves.toEqual({
      ok: false,
      failure: {
        kind: 'disabled',
        reason: 'Ontology reasoning is not configured.',
        status: null,
        errorKind: null,
        detail: null,
      },
    });
  });

  it('parses the schema response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        graph: 'neo4j',
        node_count: 3278,
        relationship_count: 211630,
        labels: [{ label: 'Drug', count: 895 }],
        relationship_types: [{ label: 'INTERACTS_WITH', count: 210000 }],
      }),
    );

    const service = buildService();
    await expect(service.schema()).resolves.toEqual({
      ok: true,
      value: {
        graph: 'neo4j',
        nodeCount: 3278,
        relationshipCount: 211630,
        labels: [{ label: 'Drug', count: 895 }],
        relationshipTypes: [{ label: 'INTERACTS_WITH', count: 210000 }],
      },
    });
  });

  it('treats an unreadable schema body as malformed', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ graph: 42 }, 200));

    const service = buildService();
    const outcome = await service.schema();

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? null : outcome.failure.kind).toBe('malformed_response');
  });

  it('parses a query result', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        columns: ['name', 'description'],
        rows: [{ name: 'Ibuprofen', description: 'CYP2C9 substrate' }],
        row_count: 1,
        truncated: false,
        elapsed_ms: 42,
      }),
    );

    const service = buildService();
    const outcome = await service.query({
      cypher: 'MATCH (d:Drug) RETURN d.name AS name LIMIT 1',
      params: {},
      limit: 10,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.ok ? outcome.value.rows : []).toEqual([
      { name: 'Ibuprofen', description: 'CYP2C9 substrate' },
    ]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://semantica:8099/query',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('surfaces the structured error kind from a rejection', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          detail: {
            kind: 'unsupported_feature',
            message:
              'The graph does not support this construct: There is no procedure with the name `apoc.path.expand`.',
            cypher: 'MATCH (d:Drug) CALL apoc.path.expand(d) RETURN d',
          },
        },
        422,
      ),
    );

    const service = buildService();
    const outcome = await service.query({
      cypher: 'MATCH (d:Drug) CALL apoc.path.expand(d) RETURN d',
      params: {},
      limit: 10,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? null : outcome.failure).toEqual({
      kind: 'rejected',
      reason:
        'The graph does not support this construct: There is no procedure with the name `apoc.path.expand`.',
      status: 422,
      errorKind: 'unsupported_feature',
      detail:
        'The graph does not support this construct: There is no procedure with the name `apoc.path.expand`.',
    });
  });

  it('maps 401/403 to unauthorized', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('nope', { status: 401 }));

    const service = buildService();
    const outcome = await service.query({
      cypher: 'MATCH (n) RETURN n',
      params: {},
      limit: 10,
    });

    expect(outcome.ok ? null : outcome.failure.kind).toBe('unauthorized');
  });

  it('maps 500 to server_error', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('boom', { status: 500 }));

    const service = buildService();
    const outcome = await service.query({
      cypher: 'MATCH (n) RETURN n',
      params: {},
      limit: 10,
    });

    expect(outcome.ok ? null : outcome.failure.kind).toBe('server_error');
  });

  it('classifies an aborted request as a timeout', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'TimeoutError';
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);

    const service = buildService();
    const outcome = await service.query({
      cypher: 'MATCH (n) RETURN n',
      params: {},
      limit: 10,
    });

    expect(outcome.ok ? null : outcome.failure.kind).toBe('timeout');
  });

  it('classifies a refused connection as unreachable', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:8099'));

    const service = buildService();
    const outcome = await service.query({
      cypher: 'MATCH (n) RETURN n',
      params: {},
      limit: 10,
    });

    expect(outcome.ok ? null : outcome.failure.kind).toBe('unreachable');
  });

  it('reports health from the enabled sidecar', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: 'ok' }));

    const service = buildService();
    await expect(service.health()).resolves.toEqual({ ok: true, reason: null });
  });

  // ── bearer token ───────────────────────────────────────────────────
  //
  // sidecar 把鉴权挂在路由级（除 /health 外的每个端点），所以凭据不是"POST 才
  // 需要"。这几条钉住的是"确实发出去了"，而不是"构造时读到了"：凭据漏发时
  // sidecar 回 401，客户端归一成 kind: 'unauthorized'，上层会把一个配置错误
  // 呈现成"推理服务不可用"——与真的挂了无从区分。

  function sentHeaders(call = 0): Record<string, string> {
    const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[
      call
    ]?.[1] as RequestInit | undefined;
    return (init?.headers ?? {}) as Record<string, string>;
  }

  it('sends the bearer token on POST requests', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ rows: [], columns: [] }));

    const service = buildService();
    await service.query({
      cypher: 'MATCH (n) RETURN n',
      params: {},
      limit: 10,
    });

    expect(sentHeaders()['Authorization']).toBe(`Bearer ${TEST_API_KEY}`);
  });

  it('sends the bearer token on GET requests too', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ graph: 'neo4j', node_count: 0 }));

    const service = buildService();
    await service.schema();

    expect(sentHeaders()['Authorization']).toBe(`Bearer ${TEST_API_KEY}`);
  });

  it('sends the token configured for this environment, not a literal', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: 'ok' }));

    const service = buildService({ [EnvKey.SEMANTICA_API_KEY]: 'rotated-key' });
    await service.health();

    expect(sentHeaders()['Authorization']).toBe('Bearer rotated-key');
  });
});
