import type { AssistantToolExecutionContext } from '../../types/assistant.types.js';
import type { OntologyCypherGeneratorService } from './cypher-generator.service.js';
import type { OntologyCypherContext } from './cypher.schema.js';
import { AssistantToolOntologyReasoningService } from './ontology-reasoning.service.js';
import type { SemanticaClientService } from './semantica-client.service.js';
import type {
  SemanticaCallFailure,
  SemanticaGraphSchema,
  SemanticaQueryOutcome,
} from './semantica.types.js';

const SCHEMA: SemanticaGraphSchema = {
  graph: 'lucent_graph',
  nodeCount: 3278,
  relationshipCount: 211630,
  labels: [{ label: 'Drug', count: 895 }],
  relationshipTypes: [{ label: 'INTERACTS_WITH', count: 210000 }],
};

const OK_ROWS: SemanticaQueryOutcome = {
  columns: ['name', 'description'],
  rows: [{ name: 'Ibuprofen', description: 'CYP2C9 substrate' }],
  rowCount: 1,
  truncated: false,
  elapsedMs: 12,
};

function rejection(
  errorKind: SemanticaCallFailure['errorKind'],
  detail: string,
): SemanticaCallFailure {
  return {
    kind: 'rejected',
    reason: detail,
    status: 422,
    errorKind,
    detail,
  };
}

describe('AssistantToolOntologyReasoningService', () => {
  function buildContext(
    toolArgs: Record<string, unknown>,
  ): AssistantToolExecutionContext {
    return {
      userId: 'user-1',
      locale: 'zh-CN',
      userMessage: '阿司匹林和布洛芬能一起吃吗',
      enabledContextSources: [],
      memoryEnabled: false,
      toolArgs,
    };
  }

  function buildService(options?: {
    enabled?: boolean;
    schemaOutcome?:
      | { ok: true; value: SemanticaGraphSchema }
      | { ok: false; failure: SemanticaCallFailure };
    hasLanguageModel?: boolean;
    generate?: ReturnType<typeof vi.fn>;
    query?: ReturnType<typeof vi.fn>;
  }) {
    const schema = vi
      .fn()
      .mockResolvedValue(options?.schemaOutcome ?? { ok: true, value: SCHEMA });
    const query =
      options?.query ?? vi.fn().mockResolvedValue({ ok: true, value: OK_ROWS });
    const generate =
      options?.generate ??
      vi.fn().mockResolvedValue({
        cypher: 'MATCH (d:Drug) RETURN d.name AS name LIMIT 5',
        params: {},
        rationale: 'list drugs',
      });

    const client = {
      isEnabled: vi.fn().mockReturnValue(options?.enabled ?? true),
      schema,
      query,
    } as unknown as SemanticaClientService;
    const generator = {
      hasLanguageModel: vi
        .fn()
        .mockReturnValue(options?.hasLanguageModel ?? true),
      generate,
    } as unknown as OntologyCypherGeneratorService;

    return {
      service: new AssistantToolOntologyReasoningService(client, generator),
      schema,
      query,
      generate,
    };
  }

  it('rejects an empty question before calling anything', async () => {
    const { service, generate, query } = buildService();
    const envelope = await service.reasonOverOntology(buildContext({}));

    expect(envelope.coverage).toEqual({
      status: 'empty',
      reason: expect.stringContaining('"question" must not be empty'),
    });
    expect(envelope.result['verifiability']).toBe('unavailable');
    expect(generate).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('reports unconfigured when the sidecar is disabled', async () => {
    const { service, generate } = buildService({ enabled: false });
    const envelope = await service.reasonOverOntology(
      buildContext({ question: 'Do aspirin and ibuprofen interact?' }),
    );

    expect(envelope.coverage.status).toBe('empty');
    expect(envelope.coverage.reason).toContain('not configured');
    expect(generate).not.toHaveBeenCalled();
  });

  it('reports unavailable when no language model is configured', async () => {
    const { service } = buildService({ hasLanguageModel: false });
    const envelope = await service.reasonOverOntology(
      buildContext({ question: 'Do aspirin and ibuprofen interact?' }),
    );

    expect(envelope.coverage.reason).toContain('no language model');
    expect(envelope.result['verifiability']).toBe('unavailable');
  });

  it('returns rows with the executed query on success', async () => {
    const { service, generate } = buildService();
    const envelope = await service.reasonOverOntology(
      buildContext({ question: 'Do aspirin and ibuprofen interact?' }),
    );

    expect(envelope.coverage).toEqual({ status: 'complete', reason: null });
    expect(envelope.confidence.level).toBe('high');
    expect(envelope.result).toMatchObject({
      cypher: 'MATCH (d:Drug) RETURN d.name AS name LIMIT 5',
      graph: 'lucent_graph',
      rowCount: 1,
      truncated: false,
      attempts: 1,
      sourceTier: 'drugbank_structured',
      verifiability: 'citable',
    });
    expect(envelope.source.tables).toEqual(['lucent_graph (Apache AGE)']);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('retries with the executor error after a rejection', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        failure: rejection(
          'syntax_error',
          'syntax error at or near "OPTIONAL"',
        ),
      })
      .mockResolvedValueOnce({ ok: true, value: OK_ROWS });
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ cypher: 'OPTIONAL MATCH (n) AS x RETURN x' })
      .mockResolvedValueOnce({ cypher: 'MATCH (n) RETURN n.name AS name' });

    const { service } = buildService({ query, generate });
    const envelope = await service.reasonOverOntology(
      buildContext({ question: 'Do aspirin and ibuprofen interact?' }),
    );

    expect(generate).toHaveBeenCalledTimes(2);
    const retryContext = generate.mock.calls[1]?.[0] as OntologyCypherContext;
    expect(retryContext.previousErrorKind).toBe('syntax_error');
    expect(retryContext.previousError).toContain('syntax error');
    expect(retryContext.previousCypher).toBe(
      'OPTIONAL MATCH (n) AS x RETURN x',
    );
    expect(envelope.result['attempts']).toBe(2);
  });

  it('does not retry an unreachable sidecar', async () => {
    const query = vi.fn().mockResolvedValue({
      ok: false,
      failure: {
        kind: 'unreachable',
        reason: 'Ontology reasoning service is unreachable.',
        status: null,
        errorKind: null,
        detail: null,
      },
    });
    const generate = vi
      .fn()
      .mockResolvedValue({ cypher: 'MATCH (n) RETURN n' });

    const { service } = buildService({ query, generate });
    const envelope = await service.reasonOverOntology(
      buildContext({ question: 'Do aspirin and ibuprofen interact?' }),
    );

    expect(generate).toHaveBeenCalledTimes(1);
    expect(envelope.coverage.reason).toContain('unavailable');
    expect(envelope.result['verifiability']).toBe('unavailable');
  });

  it('gives up after the attempt budget with the last error', async () => {
    const query = vi.fn().mockResolvedValue({
      ok: false,
      failure: rejection('syntax_error', 'syntax error at or near "x"'),
    });
    const generate = vi.fn().mockResolvedValue({ cypher: 'MATCH x' });

    const { service } = buildService({ query, generate });
    const envelope = await service.reasonOverOntology(
      buildContext({ question: 'Do aspirin and ibuprofen interact?' }),
    );

    expect(generate).toHaveBeenCalledTimes(3);
    expect(envelope.coverage.status).toBe('empty');
    expect(envelope.coverage.reason).toContain(
      'could not produce an executable query',
    );
    expect(envelope.result['attempts']).toBe(3);
  });

  it('marks zero rows as empty rather than an error', async () => {
    const query = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        columns: ['name'],
        rows: [],
        rowCount: 0,
        truncated: false,
        elapsedMs: 5,
      },
    });

    const { service } = buildService({ query });
    const envelope = await service.reasonOverOntology(
      buildContext({ question: 'Do aspirin and ibuprofen interact?' }),
    );

    expect(envelope.coverage.status).toBe('empty');
    expect(envelope.coverage.reason).toContain('no edge matching');
    expect(envelope.coverage.reason).toContain('not that none exists');
    expect(envelope.confidence.level).toBe('low');
    expect(envelope.result['verifiability']).toBe('citable');
  });

  it('marks a truncated result as partial coverage', async () => {
    const query = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        columns: ['name'],
        rows: [{ name: 'Ibuprofen' }],
        rowCount: 1,
        truncated: true,
        elapsedMs: 9,
      },
    });

    const { service } = buildService({ query });
    const envelope = await service.reasonOverOntology(
      buildContext({ question: 'Which drugs share this target?' }),
    );

    expect(envelope.coverage.status).toBe('partial');
    expect(envelope.confidence.level).toBe('medium');
    expect(envelope.result['truncated']).toBe(true);
  });

  it('clamps the limit and forwards params to the sidecar', async () => {
    const query = vi.fn().mockResolvedValue({ ok: true, value: OK_ROWS });
    const generate = vi.fn().mockResolvedValue({
      cypher:
        'MATCH (d:Drug) WHERE toLower(d.name) = $name RETURN d.name AS name LIMIT 5',
      params: { name: 'ibuprofen', bogus: { nested: true } },
    });

    const { service } = buildService({ query, generate });
    await service.reasonOverOntology(
      buildContext({ question: 'What is ibuprofen?', limit: 1000 }),
    );

    expect(query).toHaveBeenCalledWith({
      cypher: expect.stringContaining('MATCH'),
      params: { name: 'ibuprofen' },
      limit: 100,
    });
  });

  it('reports unavailable when the schema cannot be read', async () => {
    const { service, generate } = buildService({
      schemaOutcome: {
        ok: false,
        failure: {
          kind: 'unreachable',
          reason: 'Ontology reasoning service is unreachable.',
          status: null,
          errorKind: null,
          detail: null,
        },
      },
    });
    const envelope = await service.reasonOverOntology(
      buildContext({ question: 'Do aspirin and ibuprofen interact?' }),
    );

    expect(envelope.coverage.reason).toContain('unavailable');
    expect(generate).not.toHaveBeenCalled();
  });

  it('reports unavailable when generation throws', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('model exploded'));

    const { service } = buildService({ generate });
    const envelope = await service.reasonOverOntology(
      buildContext({ question: 'Do aspirin and ibuprofen interact?' }),
    );

    expect(envelope.coverage.reason).toContain('generation failed');
    expect(envelope.result['verifiability']).toBe('unavailable');
  });
});
