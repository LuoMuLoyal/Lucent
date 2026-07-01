import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { OpenAIEmbeddings } from '@langchain/openai';
import type { AiConfig } from '../../../../config/ai.config';
import { ConfigKey } from '../../../../config/config-keys.enum';
import { EnvKey } from '../../../../config/env-keys.enum';
import type {
  AssistantReadResultEnvelope,
  AssistantToolExecutionContext,
} from '../../types/assistant.types';
import {
  buildReadConfidence,
  buildReadEnvelope,
} from '../assistant-tool-presenters';
import {
  buildVectorPage,
  buildVectorQueryHash,
  decodeVectorCursor,
} from './assistant-vector-cursor';
import {
  AssistantToolDrugbankEntityResolveService,
  parseSearchPayload,
} from './assistant-tool-drugbank-entity-resolve.service';

const DRUGBANK_EMBEDDINGS_TABLE = 'drugbank_passage_embeddings';
const DEFAULT_LIMIT = 4;
const MAX_LIMIT = 8;

@Injectable()
export class AssistantToolDrugbankSearchService {
  private vectorStore: PGVectorStore | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly drugbankEntityResolveService: AssistantToolDrugbankEntityResolveService,
  ) {}

  async search(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const payload = parseSearchPayload(context.userMessage);
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

    const store = await this.getVectorStore();
    if (!store) {
      return this.buildEmptyEnvelope(
        'DrugBank vector search is not configured.',
      );
    }

    const limit = normalizeLimit(payload.limit);
    const queryHash = buildVectorQueryHash(query, {
      drugbankId: resolvedDrugbankId,
    });
    const cursor = decodeVectorCursor(payload.cursor);
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

  private async getVectorStore(): Promise<PGVectorStore | null> {
    if (this.vectorStore) return this.vectorStore;
    if (this.initPromise) {
      await this.initPromise;
      return this.vectorStore;
    }

    this.initPromise = this.initializeStore();
    await this.initPromise;
    return this.vectorStore;
  }

  private async initializeStore(): Promise<void> {
    const dbUrl = this.configService.get<string>(EnvKey.DATABASE_URL);
    if (!dbUrl) return;

    const embeddings = this.createEmbeddings();
    if (!embeddings) return;

    this.vectorStore = new PGVectorStore(embeddings, {
      postgresConnectionOptions: { connectionString: dbUrl },
      tableName: DRUGBANK_EMBEDDINGS_TABLE,
      columns: {
        idColumnName: 'id',
        vectorColumnName: 'embedding',
        contentColumnName: 'document',
        metadataColumnName: 'cmetadata',
      },
      distanceStrategy: 'cosine',
    });

    await this.vectorStore.ensureTableInDatabase();
  }

  private createEmbeddings(): OpenAIEmbeddings | null {
    const aiConfig = this.configService.get<AiConfig>(ConfigKey.Ai);
    const embedding = aiConfig?.embedding;
    if (
      !embedding ||
      !embedding.apiKey ||
      !embedding.baseUrl ||
      !embedding.model
    ) {
      return null;
    }

    return new OpenAIEmbeddings({
      apiKey: embedding.apiKey,
      configuration: { baseURL: embedding.baseUrl },
      model: embedding.model,
    });
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
          limit: DEFAULT_LIMIT,
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
  if (limit == null || Number.isNaN(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)));
}
