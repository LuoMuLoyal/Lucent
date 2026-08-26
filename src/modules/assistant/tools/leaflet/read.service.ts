import { Injectable, Logger } from '@nestjs/common';
import type { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { PrismaService } from '../../../../prisma';
import { VectorStoreFactory } from '../vector/vector-store.factory';
import type {
  AssistantReadResultEnvelope,
  AssistantToolExecutionContext,
} from '../../types/assistant.types';
import { buildReadConfidence, buildReadEnvelope } from '../presenters';
import {
  buildVectorPage,
  buildVectorQueryHash,
  decodeVectorCursor,
} from '../vector/vector-cursor';
import { parseSearchPayload } from '../drugbank/entity-resolve.service';
import {
  ASSISTANT_VECTOR_DEFAULT_LIMIT,
  ASSISTANT_VECTOR_MAX_LIMIT,
} from '../shared/tool-constants';

const VECTOR_FETCH_BUFFER = 4;
const PRODUCT_RESOLVE_FETCH_COUNT = 20;
const PRODUCT_RESOLVE_AMBIGUITY_THRESHOLD = 0.05;
const EMBEDDINGS_TABLE = 'leaflet_embeddings';

@Injectable()
export class AssistantToolLeafletReadService {
  private readonly logger = new Logger(AssistantToolLeafletReadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vectorStoreFactory: VectorStoreFactory,
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
    const payload = parseSearchPayload(context.userMessage, this.logger);
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

    const store = await this.vectorStoreFactory.getStore(EMBEDDINGS_TABLE);
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

    const productResolution = await this.resolveProductByVector(
      query,
      store,
      productIdFilter,
    );

    if (productResolution.resolvedProductId == null) {
      return this.buildEmptyEnvelope({
        medicineQuery: query,
        limit,
        offset,
        queryHash,
        reason: 'No Chinese leaflet product could be resolved for the query.',
      });
    }

    const resolvedProductId = productResolution.resolvedProductId;
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

      if (!productIds.includes(resolvedProductId)) {
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
        reason:
          'No semantically relevant Chinese leaflet chunks were found for the resolved product.',
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

    const resolvedProductName =
      productResolution.resolvedProductName ??
      chunks
        .flatMap((chunk) => chunk.productNames)
        .find((name) => name.length > 0) ??
      `product:${resolvedProductId}`;

    const candidateNames = productResolution.ambiguities;
    const coverage =
      candidateNames.length > 0
        ? {
            status: 'partial' as const,
            reason:
              'Product-level vector resolve returned multiple candidate products. Review the returned candidates before drawing conclusions.',
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
        medicine: {
          source: 'cn',
          name: resolvedProductName,
        },
        resolvedProduct: {
          source: 'cn',
          productId: resolvedProductId,
          name: resolvedProductName,
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
        ambiguities: candidateNames,
        preferredReason:
          'Resolved a Chinese leaflet product through vector aggregation before retrieving chunks.',
      }),
      ambiguities: candidateNames,
      tables: [
        'cn_medicine_leaflets',
        'medicine_leaflet_chunks',
        EMBEDDINGS_TABLE,
      ],
    });
  }

  /**
   * Resolves the most likely product for a leaflet query by aggregating
   * vector chunk scores over the existing leaflet_embeddings store. When the
   * caller already provides a productId filter, that product is returned without
   * an extra vector search.
   */
  private async resolveProductByVector(
    query: string,
    store: PGVectorStore,
    productIdFilter: string | null,
  ): Promise<{
    resolvedProductId: string | null;
    resolvedProductName: string | null;
    ambiguities: string[];
  }> {
    if (productIdFilter != null) {
      return {
        resolvedProductId: productIdFilter,
        resolvedProductName: null,
        ambiguities: [],
      };
    }

    const rawResults = await store.similaritySearchWithScore(
      query,
      PRODUCT_RESOLVE_FETCH_COUNT,
    );

    const productScores = new Map<
      string,
      {
        productId: string;
        productName: string;
        score: number;
      }
    >();

    for (const [doc, score] of rawResults) {
      const productIds = Array.isArray(doc.metadata['productIds'])
        ? (doc.metadata['productIds'] as unknown[]).filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
      const productNames = Array.isArray(doc.metadata['productNames'])
        ? (doc.metadata['productNames'] as unknown[]).filter(
            (value): value is string => typeof value === 'string',
          )
        : [];

      for (let index = 0; index < productIds.length; index += 1) {
        const productId = productIds[index];
        if (productId == null) {
          continue;
        }
        const productName = productNames[index] ?? `product:${productId}`;
        const existing = productScores.get(productId);

        if (existing == null) {
          productScores.set(productId, {
            productId,
            productName,
            score,
          });
          continue;
        }

        existing.score = Math.max(existing.score, score);
      }
    }

    const rankedProducts = [...productScores.values()].sort(
      (a, b) => b.score - a.score,
    );

    if (rankedProducts.length === 0) {
      return {
        resolvedProductId: null,
        resolvedProductName: null,
        ambiguities: [],
      };
    }

    const topProduct = rankedProducts[0];

    if (topProduct == null) {
      return {
        resolvedProductId: null,
        resolvedProductName: null,
        ambiguities: [],
      };
    }

    const ambiguities: string[] = [];

    if (rankedProducts.length >= 2) {
      const topScore = topProduct.score;
      const ambiguousProducts = rankedProducts.filter(
        (product) =>
          product.score >= topScore - PRODUCT_RESOLVE_AMBIGUITY_THRESHOLD,
      );
      if (ambiguousProducts.length > 1) {
        ambiguities.push(
          ...ambiguousProducts.map((product) => product.productName),
        );
      }
    }

    return {
      resolvedProductId: topProduct.productId,
      resolvedProductName: topProduct.productName,
      ambiguities: [...new Set(ambiguities)],
    };
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
  if (limit == null || Number.isNaN(limit))
    return ASSISTANT_VECTOR_DEFAULT_LIMIT;
  return Math.max(1, Math.min(ASSISTANT_VECTOR_MAX_LIMIT, Math.trunc(limit)));
}
