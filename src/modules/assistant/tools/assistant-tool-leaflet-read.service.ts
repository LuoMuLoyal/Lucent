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

const LEAFLET_SEARCH_LIMIT = 5;
const VECTOR_TOP_K = 5;
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

  async getMedicineLeafletContext(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const query = context.userMessage.trim();

    if (!query) {
      return this.buildEmptyEnvelope({
        medicineQuery: query,
        reason: 'No medicine query was provided.',
      });
    }

    const productResolution = await this.resolveProduct(query);

    if (productResolution.kind === 'no_match') {
      return this.buildEmptyEnvelope({
        medicineQuery: query,
        reason: `No Chinese medicine product matched "${query}".`,
      });
    }

    if (productResolution.kind === 'ambiguous') {
      return this.buildAmbiguousEnvelope({
        medicineQuery: query,
        candidates: productResolution.candidates,
      });
    }

    const product = productResolution.product;

    const store = await this.getVectorStore();
    if (!store) {
      return this.buildEmptyEnvelope({
        medicineQuery: query,
        matchedRecordId: product.id,
        matchedBy: productResolution.matchedBy,
        reason: `Matched product "${product.name}" but vector search is not configured.`,
      });
    }

    const results = await store.similaritySearchWithScore(query, VECTOR_TOP_K, {
      productId: product.id,
    });

    if (results.length === 0) {
      return this.buildEmptyEnvelope({
        medicineQuery: query,
        matchedRecordId: product.id,
        matchedBy: productResolution.matchedBy,
        reason: `Matched product "${product.name}" but no semantically relevant chunks were found.`,
      });
    }

    const chunks = results.map(([doc, score], index) => ({
      leafletId: doc.metadata['leafletId'] as string,
      field: doc.metadata['sourceField'] as string,
      text: doc.pageContent,
      rank: index + 1,
      score,
    }));

    return buildReadEnvelope({
      toolName: 'get_medicine_leaflet_context',
      query: {
        medicineQuery: query,
        matchedSource: 'cn',
        matchedRecordId: product.id,
        matchedLeafletIds: [...new Set(chunks.map((c) => c.leafletId))],
        matchedBy: productResolution.matchedBy,
        retrievalMethod: 'vector',
      },
      result: {
        medicine: {
          id: product.id,
          source: 'cn',
          name: product.name,
          manufacturer: product.manufacturer,
          approvalNumber: product.approvalNumber,
        },
        leaflets: [],
        chunks,
      },
      coverage:
        chunks.length > 0
          ? { status: 'complete', reason: null }
          : {
              status: 'empty',
              reason: 'Matched product but no indexed chunks were found.',
            },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: buildReadConfidence({
        ambiguities: [],
        preferredReason:
          'Matched a single Chinese product with vector-semantic leaflet chunks.',
      }),
      ambiguities: [],
      tables: [
        'cn_medicine_products',
        'cn_medicine_leaflets',
        'cn_medicine_product_leaflet_links',
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

  private buildEmptyEnvelope(input: {
    medicineQuery: string;
    matchedBy?: string[];
    matchedRecordId?: string;
    reason: string;
  }): AssistantReadResultEnvelope {
    return buildReadEnvelope({
      toolName: 'get_medicine_leaflet_context',
      query: {
        medicineQuery: input.medicineQuery,
        matchedBy: input.matchedBy ?? [],
        matchedRecordId: input.matchedRecordId ?? null,
      },
      result: { medicine: null, leaflets: [], chunks: [] },
      coverage: { status: 'empty', reason: input.reason },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: {
        level: 'low',
        reason: 'No matching product or leaflet coverage was found.',
      },
      ambiguities: [],
      tables: [EMBEDDINGS_TABLE],
    });
  }

  private buildAmbiguousEnvelope(input: {
    medicineQuery: string;
    candidates: string[];
  }): AssistantReadResultEnvelope {
    return buildReadEnvelope({
      toolName: 'get_medicine_leaflet_context',
      query: {
        medicineQuery: input.medicineQuery,
        matchedBy: [],
      },
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
      tables: [EMBEDDINGS_TABLE],
    });
  }
}
