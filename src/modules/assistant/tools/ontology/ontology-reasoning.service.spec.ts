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

const CITATION = {
  id: 'lucent:drugbank_drugs/DB00004/drug_interactions/DB14766',
  entityType: 'graph_assertion',
  sourceDocument: 'lucent.drugbank_drugs.drug_interactions',
  sourceLocation: 'drugbank_id=DB00004, drugbankId=DB14766',
  sourceQuote: 'The risk or severity of immunosuppression can be increased.',
  activityId: 'lucent:ingest/drugbank_xml@2026-03-05',
  agentId: 'drugbank:full database.xml@2026-03-05',
  agentType: 'source_dataset',
  confidence: 1,
  timestamp: '2026-09-19T13:00:00+00:00',
  sequenceId: 12,
  checksum: 'checksum-12',
  parentEntityId: null,
  metadata: { edge_type: 'INTERACTS_WITH' },
} as const;

const OK_ROWS: SemanticaQueryOutcome = {
  columns: ['name', 'description'],
  rows: [{ name: 'Ibuprofen', description: 'CYP2C9 substrate' }],
  rowCount: 1,
  truncated: false,
  elapsedMs: 12,
  citations: [CITATION],
  citationsMissing: [],
  citationsTruncated: false,
  citationsError: null,
};

/** 有行但没有带回任何引用：这些行没有可回溯的来源，不能自称 citable。 */
const ROWS_WITHOUT_CITATIONS: SemanticaQueryOutcome = {
  ...OK_ROWS,
  citations: [],
};

/** 零行 / 截断用例只关心覆盖率判定，引用字段取"没有引用"。 */
const NO_CITATIONS = {
  citations: [],
  citationsMissing: [],
  citationsTruncated: false,
  citationsError: null,
} as const;

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
      citationCount: 1,
      citationsTruncated: false,
    });
    expect(envelope.result['citations']).toEqual([
      {
        id: CITATION.id,
        entityType: CITATION.entityType,
        sourceDocument: CITATION.sourceDocument,
        sourceLocation: CITATION.sourceLocation,
        sourceQuote: CITATION.sourceQuote,
        activityId: CITATION.activityId,
        agentId: CITATION.agentId,
        confidence: CITATION.confidence,
        sequenceId: CITATION.sequenceId,
        checksum: CITATION.checksum,
        parentEntityId: null,
      },
    ]);
    expect(envelope.source.tables).toEqual(['lucent_graph (Apache AGE)']);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('reports rows without citations as uncited rather than citable', async () => {
    const query = vi.fn().mockResolvedValue({
      ok: true,
      value: ROWS_WITHOUT_CITATIONS,
    });
    const generate = vi
      .fn()
      .mockResolvedValue({ cypher: 'MATCH (n) RETURN n.name AS name' });

    const { service } = buildService({ query, generate });
    const envelope = await service.reasonOverOntology(
      buildContext({ question: 'Which drugs share this target?' }),
    );

    expect(envelope.result['verifiability']).toBe('uncited');
    expect(envelope.result['citations']).toEqual([]);
    expect(envelope.result['citationCount']).toBe(0);
  });

  it('asks once for a rewrite that returns provenance, then accepts the answer', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: ROWS_WITHOUT_CITATIONS })
      .mockResolvedValueOnce({ ok: true, value: OK_ROWS });
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ cypher: 'MATCH (n) RETURN n.name AS name' })
      .mockResolvedValueOnce({
        cypher: 'MATCH (a)-[r]->(b) RETURN a.name AS name, r.prov AS prov',
      });

    const { service } = buildService({ query, generate });
    const envelope = await service.reasonOverOntology(
      buildContext({ question: 'Which drugs share this target?' }),
    );

    expect(generate).toHaveBeenCalledTimes(2);
    const retryContext = generate.mock.calls[1]?.[0] as OntologyCypherContext;
    expect(retryContext.previousErrorKind).toBe('missing_provenance');
    expect(retryContext.previousError).toContain('no provenance id came back');
    expect(envelope.result['verifiability']).toBe('citable');
    expect(envelope.result['citationCount']).toBe(1);
  });

  it('does not loop on provenance: a second uncited answer is returned as uncited', async () => {
    const query = vi.fn().mockResolvedValue({
      ok: true,
      value: ROWS_WITHOUT_CITATIONS,
    });
    const generate = vi
      .fn()
      .mockResolvedValue({
        cypher: 'MATCH (n) RETURN n.known_for_treatments AS x',
      });

    const { service } = buildService({ query, generate });
    const envelope = await service.reasonOverOntology(
      buildContext({ question: 'What is warfarin indicated for?' }),
    );

    // 属性类问题本来就没有关系可引：只强制一次，不能把预算耗在同一个形状上。
    expect(generate).toHaveBeenCalledTimes(2);
    expect(envelope.result['verifiability']).toBe('uncited');
    expect(envelope.result['rowCount']).toBe(1);
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
        ...NO_CITATIONS,
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
        ...NO_CITATIONS,
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
