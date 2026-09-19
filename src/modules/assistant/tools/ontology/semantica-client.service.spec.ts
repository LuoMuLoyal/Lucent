import type { ConfigService } from '@nestjs/config';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import { SemanticaClientService } from './semantica-client.service.js';

describe('SemanticaClientService', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function buildService(overrides?: Record<string, unknown>) {
    const values: Record<string, unknown> = {
      [EnvKey.SEMANTICA_ENABLED]: 'true',
      [EnvKey.SEMANTICA_BASE_URL]: 'http://semantica:8099',
      [EnvKey.SEMANTICA_TIMEOUT_MS]: 20000,
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
        graph: 'lucent_graph',
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
        graph: 'lucent_graph',
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
            message: 'AGE does not support multi-type edges.',
            cypher: 'MATCH (d:Drug)-[r:A|B]->(o) RETURN o',
          },
        },
        422,
      ),
    );

    const service = buildService();
    const outcome = await service.query({
      cypher: 'MATCH (d:Drug)-[r:A|B]->(o) RETURN o',
      params: {},
      limit: 10,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? null : outcome.failure).toEqual({
      kind: 'rejected',
      reason: 'AGE does not support multi-type edges.',
      status: 422,
      errorKind: 'unsupported_feature',
      detail: 'AGE does not support multi-type edges.',
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
});
