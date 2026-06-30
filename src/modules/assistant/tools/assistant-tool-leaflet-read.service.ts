import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { LlmRuntimeService } from '../../llm-runtime/services/llm-runtime.service';
import type {
  AssistantReadResultEnvelope,
  AssistantToolExecutionContext,
} from '../types/assistant.types';
import {
  buildReadConfidence,
  buildReadEnvelope,
} from './assistant-tool-presenters';

const LEAFLET_SEARCH_LIMIT = 5;
const VECTOR_TOP_K = 5;
const VECTOR_MIN_SIMILARITY = 0.7;

type LeafletChunkRow = {
  id: string;
  leaflet_id: string;
  source_field: string;
  chunk_text: string;
  chunk_index: number;
  similarity: number;
};

@Injectable()
export class AssistantToolLeafletReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmRuntime: LlmRuntimeService,
  ) {}

  async hasIndexedChunks(): Promise<boolean> {
    const count = await this.prisma.medicineLeafletChunk.count({
      take: 1,
    });
    return count > 0;
  }

  async getMedicineLeafletContext(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const query = context.userMessage.trim();

    if (!query) {
      return this.buildEmptyEnvelope({
        query: { medicineQuery: query, matchedBy: [] },
        reason: 'No medicine query was provided.',
      });
    }

    const productResolution = await this.resolveProduct(query);

    if (productResolution.kind === 'no_match') {
      return this.buildEmptyEnvelope({
        query: { medicineQuery: query, matchedBy: [] },
        reason: `No Chinese medicine product matched "${query}".`,
      });
    }

    if (productResolution.kind === 'ambiguous') {
      return this.buildAmbiguousEnvelope({
        query: { medicineQuery: query, matchedBy: [] },
        candidates: productResolution.candidates,
      });
    }

    const product = productResolution.product;

    // ── Hybrid retrieval: vector search first, fallback to keyword ──
    const vectorChunks = await this.searchByVector(query, product.id);

    if (vectorChunks.length > 0) {
      const topSimilarity = vectorChunks[0]?.similarity ?? 0;
      if (topSimilarity >= VECTOR_MIN_SIMILARITY) {
        const mapped = vectorChunks.map((row, index) => ({
          leafletId: row.leaflet_id,
          field: row.source_field,
          text: row.chunk_text,
          rank: index + 1,
        }));
        return this.buildResultEnvelope(
          query,
          product,
          productResolution.matchedBy,
          [],
          mapped,
          'vector',
        );
      }
    }

    // ── Keyword fallback ──────────────────────────────────────────
    const links = await this.prisma.cnMedicineProductLeafletLink.findMany({
      where: { productId: product.id },
      include: { leaflet: true },
      orderBy: [{ isBestMatch: 'desc' }, { matchScore: 'desc' }],
      take: 10,
    });

    if (links.length === 0) {
      return this.buildEmptyEnvelope({
        query: {
          medicineQuery: query,
          matchedRecordId: product.id,
          matchedBy: productResolution.matchedBy,
        },
        reason: `Matched product "${product.name}" but no leaflet link is available.`,
      });
    }

    const leafletIds = links.map((link) => link.leafletId);
    const chunks = await this.prisma.medicineLeafletChunk.findMany({
      where: { leafletId: { in: leafletIds } },
      orderBy: [
        { leafletId: 'asc' },
        { sourceField: 'asc' },
        { chunkIndex: 'asc' },
      ],
      take: 50,
    });

    const leaflets = links.map((link) => ({
      id: link.leaflet.id,
      instructionId: link.leaflet.instructionId,
      genericName: link.leaflet.genericName,
      manufacturer: link.leaflet.manufacturer,
      approvalCodes: (link.leaflet.approvalCodes as string[] | null) ?? [],
      isBestMatch: link.isBestMatch ?? false,
      matchScore: link.matchScore,
    }));

    const keywordChunks = chunks.map((chunk, index) => ({
      leafletId: chunk.leafletId,
      field: chunk.sourceField,
      text: chunk.chunkText,
      rank: index + 1,
    }));

    return this.buildResultEnvelope(
      query,
      product,
      productResolution.matchedBy,
      leaflets,
      keywordChunks,
      'keyword',
    );
  }

  /**
   * Semantic vector search using pgvector cosine distance.
   * Returns chunks ranked by similarity (descending).
   * Returns empty array when embedding is not configured.
   */
  private async searchByVector(
    query: string,
    productId: string,
  ): Promise<LeafletChunkRow[]> {
    const embeddingModel = this.llmRuntime.createEmbeddingModel();
    if (!embeddingModel) {
      return [];
    }

    try {
      const queryVector = await embeddingModel.embedQuery(query);
      const vectorStr = `[${queryVector.join(',')}]`;

      const rows = await this.prisma.$queryRaw<LeafletChunkRow[]>`
        SELECT
          mc.id,
          mc.leaflet_id,
          mc.source_field,
          mc.chunk_text,
          mc.chunk_index,
          1 - (mc.embedding <=> ${vectorStr}::vector) AS similarity
        FROM medicine_leaflet_chunks mc
        JOIN cn_medicine_product_leaflet_links l
          ON l.leaflet_id = mc.leaflet_id
        WHERE l.product_id = ${productId}
          AND mc.embedding IS NOT NULL
        ORDER BY mc.embedding <=> ${vectorStr}::vector
        LIMIT ${VECTOR_TOP_K}
      `;

      return rows;
    } catch {
      return [];
    }
  }

  private async resolveProduct(query: string) {
    const candidates = await this.prisma.cnMedicineProduct.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { brandName: { contains: query, mode: 'insensitive' } },
          { approvalNumber: { contains: query, mode: 'insensitive' } },
          { barcode: { contains: query, mode: 'insensitive' } },
          { nationalDrugCode: { contains: query, mode: 'insensitive' } },
          { searchText: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ name: 'asc' }],
      take: LEAFLET_SEARCH_LIMIT,
    });

    if (candidates.length === 0) {
      return { kind: 'no_match' as const };
    }

    const withLinkCounts = await Promise.all(
      candidates.map(async (product) => {
        const count = await this.prisma.cnMedicineProductLeafletLink.count({
          where: { productId: product.id },
        });
        return { product, hasLinks: count > 0 };
      }),
    );

    const linked = withLinkCounts.filter(({ hasLinks }) => hasLinks);

    if (linked.length === 0) {
      return { kind: 'no_match' as const };
    }

    if (linked.length === 1) {
      const match = linked[0];
      if (match == null) {
        return { kind: 'no_match' as const };
      }
      const { product } = match;
      return {
        kind: 'single' as const,
        product,
        matchedBy: this.describeMatchedBy(query, product),
        ambiguities: [],
      };
    }

    const names = linked.map(({ product }) => product.name);
    return {
      kind: 'ambiguous' as const,
      candidates: names,
    };
  }

  private describeMatchedBy(
    query: string,
    product: {
      name: string | null;
      brandName: string | null;
      approvalNumber: string | null;
    },
  ) {
    const matchedBy: string[] = [];
    const lowerQuery = query.toLowerCase();
    if (product.name?.toLowerCase().includes(lowerQuery)) {
      matchedBy.push('name');
    }
    if (product.brandName?.toLowerCase().includes(lowerQuery)) {
      matchedBy.push('brandName');
    }
    if (product.approvalNumber?.toLowerCase().includes(lowerQuery)) {
      matchedBy.push('approvalNumber');
    }
    return matchedBy.length > 0 ? matchedBy : ['searchText'];
  }

  private buildResultEnvelope(
    query: string,
    product: {
      id: string;
      name: string | null;
      manufacturer: string | null;
      approvalNumber: string | null;
    },
    matchedBy: string[],
    leaflets: {
      id: string;
      instructionId: string | null;
      genericName: string | null;
      manufacturer: string | null;
      approvalCodes: string[];
      isBestMatch: boolean;
      matchScore: number | null;
    }[],
    chunks: {
      leafletId: string;
      field: string;
      text: string;
      rank: number;
    }[],
    retrievalMethod: 'vector' | 'keyword',
  ): AssistantReadResultEnvelope {
    return buildReadEnvelope({
      toolName: 'get_medicine_leaflet_context',
      query: {
        medicineQuery: query,
        matchedSource: 'cn',
        matchedRecordId: product.id,
        matchedLeafletIds: [...new Set(chunks.map((c) => c.leafletId))],
        matchedBy,
        retrievalMethod,
      },
      result: {
        medicine: {
          id: product.id,
          source: 'cn',
          name: product.name,
          manufacturer: product.manufacturer,
          approvalNumber: product.approvalNumber,
        },
        leaflets,
        chunks,
      },
      coverage:
        chunks.length > 0
          ? { status: 'complete', reason: null }
          : {
              status: 'empty',
              reason:
                'Matched product but no indexed chunks were found. Run the leaflet index rebuild.',
            },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: buildReadConfidence({
        ambiguities: [],
        preferredReason:
          retrievalMethod === 'vector'
            ? 'Matched a single Chinese product with vector-semantic leaflet chunks.'
            : 'Matched a single Chinese product with keyword-based leaflet chunks.',
      }),
      ambiguities: [],
      tables: [
        'cn_medicine_products',
        'cn_medicine_leaflets',
        'cn_medicine_product_leaflet_links',
        'medicine_leaflet_chunks',
      ],
    });
  }

  private buildEmptyEnvelope(input: {
    query: Record<string, unknown>;
    reason: string;
  }): AssistantReadResultEnvelope {
    return buildReadEnvelope({
      toolName: 'get_medicine_leaflet_context',
      query: input.query,
      result: { medicine: null, leaflets: [], chunks: [] },
      coverage: { status: 'empty', reason: input.reason },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: {
        level: 'low',
        reason: 'No matching product or leaflet coverage was found.',
      },
      ambiguities: [],
      tables: [
        'cn_medicine_products',
        'cn_medicine_leaflets',
        'cn_medicine_product_leaflet_links',
        'medicine_leaflet_chunks',
      ],
    });
  }

  private buildAmbiguousEnvelope(input: {
    query: Record<string, unknown>;
    candidates: string[];
  }): AssistantReadResultEnvelope {
    return buildReadEnvelope({
      toolName: 'get_medicine_leaflet_context',
      query: input.query,
      result: {
        medicine: null,
        leaflets: [],
        chunks: [],
        candidates: input.candidates,
      },
      coverage: {
        status: 'partial',
        reason: `Multiple products matched the query: ${input.candidates.join(', ')}.`,
      },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: {
        level: 'low',
        reason: 'Multiple candidate medicines matched the query.',
      },
      ambiguities: input.candidates,
      tables: [
        'cn_medicine_products',
        'cn_medicine_leaflets',
        'cn_medicine_product_leaflet_links',
        'medicine_leaflet_chunks',
      ],
    });
  }
}
