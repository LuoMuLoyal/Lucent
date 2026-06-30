import { Injectable } from '@nestjs/common';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import type {
  AssistantReadResultEnvelope,
  AssistantToolExecutionContext,
} from '../types/assistant.types';
import {
  buildReadConfidence,
  buildReadEnvelope,
} from './assistant-tool-presenters';

const VECTOR_TOP_K = 5;
const EMBEDDINGS_TABLE = 'medical_qa_embeddings';

const DISCLAIMER =
  '以下内容来自医学知识库，仅供参考，不能替代专业医疗建议。如有健康问题请咨询医生。';

@Injectable()
export class AssistantToolMedicalKnowledgeService {
  private vectorStore: PGVectorStore | null = null;
  private initPromise: Promise<void> | null = null;

  async getMedicalKnowledge(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const query = context.userMessage.trim();

    if (!query) {
      return buildReadEnvelope({
        toolName: 'get_medical_knowledge',
        query: { medicineQuery: query },
        result: { knowledge: [], disclaimer: DISCLAIMER },
        coverage: { status: 'empty', reason: 'No query was provided.' },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: { level: 'low', reason: 'Empty query.' },
        ambiguities: [],
        tables: [EMBEDDINGS_TABLE],
      });
    }

    const store = await this.getVectorStore();
    if (!store) {
      return buildReadEnvelope({
        toolName: 'get_medical_knowledge',
        query: { medicineQuery: query },
        result: { knowledge: [], disclaimer: DISCLAIMER },
        coverage: {
          status: 'empty',
          reason: 'Medical knowledge vector store is not configured.',
        },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: { level: 'low', reason: 'Vector store unavailable.' },
        ambiguities: [],
        tables: [EMBEDDINGS_TABLE],
      });
    }

    const results = await store.similaritySearchWithScore(query, VECTOR_TOP_K);

    if (results.length === 0) {
      return buildReadEnvelope({
        toolName: 'get_medical_knowledge',
        query: { medicineQuery: query },
        result: { knowledge: [], disclaimer: DISCLAIMER },
        coverage: {
          status: 'empty',
          reason: 'No relevant medical knowledge found for this query.',
        },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: { level: 'low', reason: 'No matching chunks.' },
        ambiguities: [],
        tables: [EMBEDDINGS_TABLE],
      });
    }

    const chunks = results.map(([doc, score], index) => ({
      qaId: doc.metadata['qaId'] as string,
      question: doc.metadata['question'] as string,
      answer: doc.pageContent,
      safetyLabel: doc.metadata['safetyLabel'] as string,
      rank: index + 1,
      score,
    }));

    return buildReadEnvelope({
      toolName: 'get_medical_knowledge',
      query: { medicineQuery: query },
      result: {
        knowledge: chunks,
        disclaimer: DISCLAIMER,
      },
      coverage:
        chunks.length > 0
          ? { status: 'complete', reason: null }
          : { status: 'empty', reason: 'No matching knowledge chunks.' },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: buildReadConfidence({
        ambiguities: [],
        preferredReason:
          'Retrieved medical knowledge chunks via semantic search.',
      }),
      ambiguities: [],
      tables: [EMBEDDINGS_TABLE],
    });
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
    const dbUrl = process.env['DATABASE_URL'];
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
    const raw = process.env as Record<string, string | undefined>;
    const apiKey = raw['AI_EMBEDDING_API_KEY']?.trim();
    const baseUrl = raw['AI_EMBEDDING_BASE_URL']?.trim();
    const model = raw['AI_EMBEDDING_MODEL']?.trim();

    if (!apiKey || !baseUrl || !model) return null;

    return new OpenAIEmbeddings({
      apiKey,
      configuration: { baseURL: baseUrl },
      model,
    });
  }
}
