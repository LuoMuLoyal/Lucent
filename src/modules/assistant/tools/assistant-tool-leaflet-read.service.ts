import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { PrismaService } from '../../../prisma/prisma.service';
import { ConfigKey } from '../../../config/config-keys.enum';
import { EnvKey } from '../../../config/env-keys.enum';
import type { AiConfig } from '../../../config/ai.config';
import type {
  AssistantReadResultEnvelope,
  AssistantToolExecutionContext,
} from '../types/assistant.types';
import {
  buildReadConfidence,
  buildReadEnvelope,
} from './assistant-tool-presenters';
import {
  buildVectorPage,
  buildVectorQueryHash,
  decodeVectorCursor,
} from './services/assistant-vector-cursor';
import { parseSearchPayload } from './services/assistant-tool-drugbank-entity-resolve.service';

const DEFAULT_LIMIT = 4;
const MAX_LIMIT = 8;
const VECTOR_FETCH_BUFFER = 4;
const EMBEDDINGS_TABLE = 'leaflet_embeddings';

@Injectable()
export class AssistantToolLeafletReadService {
  private vectorStore: PGVectorStore | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async hasIndexedChunks(): Promise<boolean> {
    const count = await this.prisma.medicineLeafletChunk.count({
      take: 1,
    });
    return count > 0;
  }

  async searchMedicineLeaflets(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const payload = parseSearchPayload(context.userMessage);
    const query = payload.query.trim();
    const limit = normalizeLimit(payload.limit);
    const queryHash = buildVectorQueryHash(query, payload.filters);
    const cursor = decodeVectorCursor(payload.cursor);
    const offset =
      cursor != null && cursor.queryHash === queryHash ? cursor.offset : 0;

    if (!query) {
      return this.buildEmptyEnvelope({
        medicineQuery: query,
        limit,
        offset,
        queryHash,
        reason: 'No medicine query was provided.',
      });
    }

    const store = await this.getVectorStore();
    if (!store) {
      return this.buildEmptyEnvelope({
        medicineQuery: query,
        limit,
        offset,
        queryHash,
        reason: 'Chinese leaflet vector search is not configured.',
      });
    }

    const metadataFilters = payload.filters;
    const productIdFilter =
      typeof metadataFilters['productId'] === 'string'
        ? metadataFilters['productId']
        : null;
    const sourceFieldFilter =
      typeof metadataFilters['sourceField'] === 'string'
        ? metadataFilters['sourceField']
        : null;
    const rawResults = await store.similaritySearchWithScore(
      query,
      offset + limit + VECTOR_FETCH_BUFFER,
    );
    const filteredResults = rawResults.filter(([doc]) => {
      const productIds = Array.isArray(doc.metadata['productIds'])
        ? (doc.metadata['productIds'] as unknown[]).filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
      const sourceField =
        typeof doc.metadata['sourceField'] === 'string'
          ? doc.metadata['sourceField']
          : null;

      if (productIdFilter != null && !productIds.includes(productIdFilter)) {
        return false;
      }

      if (sourceFieldFilter != null && sourceField !== sourceFieldFilter) {
        return false;
      }

      return true;
    });
    const pageResults = filteredResults.slice(offset, offset + limit);
    const hasMore = filteredResults.length > offset + limit;

    if (pageResults.length === 0) {
      return this.buildEmptyEnvelope({
        medicineQuery: query,
        limit,
        offset,
        queryHash,
        reason: 'No semantically relevant Chinese leaflet chunks were found.',
      });
    }

    const chunks = pageResults.map(([doc, score], index) => ({
      chunkId:
        typeof doc.metadata['chunkId'] === 'string'
          ? doc.metadata['chunkId']
          : null,
      leafletId: String(doc.metadata['leafletId'] ?? ''),
      field: String(doc.metadata['sourceField'] ?? ''),
      productIds: Array.isArray(doc.metadata['productIds'])
        ? (doc.metadata['productIds'] as unknown[]).filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
      productNames: Array.isArray(doc.metadata['productNames'])
        ? (doc.metadata['productNames'] as unknown[]).filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
      text: doc.pageContent,
      rank: offset + index + 1,
      score,
    }));
    const candidateNames = [
      ...new Set(
        chunks.flatMap((chunk) =>
          chunk.productNames.length > 0
            ? chunk.productNames
            : chunk.productIds.map((productId) => `product:${productId}`),
        ),
      ),
    ];
    const primaryProductLabel = candidateNames[0] ?? null;
    const coverage =
      candidateNames.length > 1
        ? {
            status: 'partial' as const,
            reason:
              'Leaflet evidence matched multiple candidate products. Review the returned candidates before drawing conclusions.',
          }
        : { status: 'complete' as const, reason: null };

    return buildReadEnvelope({
      toolName: 'search_medicine_leaflets',
      query: {
        medicineQuery: query,
        matchedSource: 'cn',
        matchedLeafletIds: [...new Set(chunks.map((c) => c.leafletId))],
        retrievalMethod: 'vector',
        filters: metadataFilters,
      },
      result: {
        medicine:
          primaryProductLabel == null
            ? null
            : {
                source: 'cn',
                name: primaryProductLabel,
              },
        leaflets: [],
        chunks,
        candidates: candidateNames,
        page: buildVectorPage({
          limit,
          offset,
          hasMore,
          queryHash,
        }),
      },
      coverage,
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: buildReadConfidence({
        ambiguities: candidateNames.length > 1 ? candidateNames : [],
        preferredReason:
          'Retrieved Chinese leaflet chunks through semantic vector search without keyword fallback.',
      }),
      ambiguities: candidateNames.length > 1 ? candidateNames : [],
      tables: [
        'cn_medicine_leaflets',
        'medicine_leaflet_chunks',
        EMBEDDINGS_TABLE,
      ],
    });
  }

  /**
   * Lazily initializes the PGVectorStore backed by the leaflet_embeddings table.
   * Returns null when embedding is not configured.
   */
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
      tableName: EMBEDDINGS_TABLE,
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

  private buildEmptyEnvelope(input: {
    medicineQuery: string;
    limit: number;
    offset: number;
    queryHash: string;
    reason: string;
  }): AssistantReadResultEnvelope {
    return buildReadEnvelope({
      toolName: 'search_medicine_leaflets',
      query: {
        medicineQuery: input.medicineQuery,
        retrievalMethod: 'vector',
      },
      result: {
        medicine: null,
        leaflets: [],
        chunks: [],
        candidates: [],
        page: buildVectorPage({
          limit: input.limit,
          offset: input.offset,
          hasMore: false,
          queryHash: input.queryHash,
        }),
      },
      coverage: { status: 'empty', reason: input.reason },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: {
        level: 'low',
        reason: 'No semantically relevant Chinese leaflet evidence was found.',
      },
      ambiguities: [],
      tables: [
        'cn_medicine_leaflets',
        'medicine_leaflet_chunks',
        EMBEDDINGS_TABLE,
      ],
    });
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit == null || Number.isNaN(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)));
}
