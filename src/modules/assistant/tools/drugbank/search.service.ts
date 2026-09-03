import { Injectable, Logger } from '@nestjs/common';
import { VectorStoreFactory } from '../vector/vector-store.factory.js';
import type {
  AssistantReadResultEnvelope,
  AssistantToolExecutionContext,
} from '../../types/assistant.types.js';
import { buildReadConfidence, buildReadEnvelope } from '../presenters.js';
import {
  buildVectorPage,
  buildVectorQueryHash,
  decodeVectorCursor,
} from '../vector/vector-cursor.js';
import {
  AssistantToolDrugbankEntityResolveService,
  parseSearchPayload,
} from './entity-resolve.service.js';
import {
  ASSISTANT_VECTOR_DEFAULT_LIMIT,
  ASSISTANT_VECTOR_MAX_LIMIT,
} from '../shared/tool-constants.js';

const DRUGBANK_EMBEDDINGS_TABLE = 'drugbank_passage_embeddings';

@Injectable()
export class AssistantToolDrugbankSearchService {
  private readonly logger = new Logger(AssistantToolDrugbankSearchService.name);

  constructor(
    private readonly vectorStoreFactory: VectorStoreFactory,
    private readonly drugbankEntityResolveService: AssistantToolDrugbankEntityResolveService,
  ) {}

  async search(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const payload = parseSearchPayload(context.userMessage, this.logger);
    const query = payload.query.trim();
    const filters = payload.filters;
    const requestedDrugbankId =
      typeof filters['drugbankId'] === 'string' ? filters['drugbankId'] : null;

    if (!query) {
      return this.buildEmptyEnvelope('No DrugBank search query was provided.');
    }

    const resolvedDrugbankId =
      requestedDrugbankId ?? (await this.resolveSingleDrugbankId(context));

    if (!resolvedDrugbankId) {
      return this.buildEmptyEnvelope(
        'DrugBank passage search requires one resolved DrugBank entity scope.',
      );
    }

    const store = await this.vectorStoreFactory.getStore(
      DRUGBANK_EMBEDDINGS_TABLE,
    );
    if (!store) {
      return this.buildEmptyEnvelope(
        'DrugBank vector search is not configured.',
      );
    }

    const limit = normalizeLimit(payload.limit);
    const queryHash = buildVectorQueryHash(query, {
      drugbankId: resolvedDrugbankId,
    });
    const cursor = decodeVectorCursor(payload.cursor, this.logger);
    const offset =
      cursor != null && cursor.queryHash === queryHash ? cursor.offset : 0;
    const rawResults = await store.similaritySearchWithScore(
      query,
      offset + limit + 1,
      { drugbankId: resolvedDrugbankId },
    );
    const pageResults = rawResults.slice(offset, offset + limit);
    const hasMore = rawResults.length > offset + limit;

    if (pageResults.length === 0) {
      return this.buildEmptyEnvelope(
        `No relevant DrugBank passages were found for "${query}".`,
        resolvedDrugbankId,
      );
    }

    const firstEntry = pageResults[0];
    const firstDoc = firstEntry?.[0];
    const passages = pageResults.map(([doc, score], index) => ({
      drugbankId: doc.metadata['drugbankId'] as string,
      drugName: doc.metadata['drugName'] as string,
      field: doc.metadata['field'] as string,
      text: doc.pageContent,
      rank: offset + index + 1,
      score,
    }));

    return buildReadEnvelope({
      toolName: 'search_drugbank_passages',
      query: {
        query,
        resolvedDrugbankId,
        retrievalMethod: 'vector',
      },
      result: {
        entity: {
          drugbankId: resolvedDrugbankId,
          name:
            firstDoc != null &&
            typeof firstDoc.metadata['drugName'] === 'string'
              ? firstDoc.metadata['drugName']
              : null,
        },
        passages,
        page: buildVectorPage({
          limit,
          offset,
          hasMore,
          queryHash,
        }),
      },
      coverage: { status: 'complete', reason: null },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: buildReadConfidence({
        ambiguities: [],
        preferredReason:
          'Retrieved DrugBank scientific passages inside one resolved entity scope.',
      }),
      ambiguities: [],
      tables: ['drugbank_drugs', DRUGBANK_EMBEDDINGS_TABLE],
    });
  }

  private async resolveSingleDrugbankId(
    context: AssistantToolExecutionContext,
  ): Promise<string | null> {
    const resolution = await this.drugbankEntityResolveService.resolve(context);
    if (resolution.coverage.status !== 'complete') {
      return null;
    }

    const entities = resolution.result['entities'];
    if (!Array.isArray(entities) || entities.length !== 1) {
      return null;
    }

    const entity: unknown = entities[0];
    if (entity == null || typeof entity !== 'object') {
      return null;
    }
    const entityRecord = entity as Record<string, unknown>;
    const drugbankId = entityRecord['drugbankId'];
    return typeof drugbankId === 'string' ? drugbankId : null;
  }

  private buildEmptyEnvelope(
    reason: string,
    resolvedDrugbankId: string | null = null,
  ): AssistantReadResultEnvelope {
    return buildReadEnvelope({
      toolName: 'search_drugbank_passages',
      query: {
        resolvedDrugbankId,
      },
      result: {
        entity: resolvedDrugbankId
          ? {
              drugbankId: resolvedDrugbankId,
              name: null,
            }
          : null,
        passages: [],
        page: buildVectorPage({
          limit: ASSISTANT_VECTOR_DEFAULT_LIMIT,
          offset: 0,
          hasMore: false,
          queryHash: buildVectorQueryHash('', {}),
        }),
      },
      coverage: { status: 'empty', reason },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: {
        level: 'low',
        reason: 'No DrugBank scientific passage evidence was retrieved.',
      },
      ambiguities: [],
      tables: [DRUGBANK_EMBEDDINGS_TABLE],
    });
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit == null || Number.isNaN(limit))
    return ASSISTANT_VECTOR_DEFAULT_LIMIT;
  return Math.max(1, Math.min(ASSISTANT_VECTOR_MAX_LIMIT, Math.trunc(limit)));
}
