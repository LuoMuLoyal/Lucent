import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { ConfigKey } from '../../../../config/config-keys.enum';
import { EnvKey } from '../../../../config/env-keys.enum';
import type { AiConfig } from '../../../../config/ai.config';
import type {
  AssistantReadResultEnvelope,
  AssistantToolExecutionContext,
} from '../../types/assistant.types';
import {
  buildReadConfidence,
  buildReadEnvelope,
} from '../assistant-tool-presenters';

const VECTOR_TOP_K = 5;
const EMBEDDINGS_TABLE = 'medical_qa_embeddings';

@Injectable()
export class AssistantToolMedicalKnowledgeService {
  private vectorStore: PGVectorStore | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
  ) {}

  async getMedicalKnowledge(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const query = context.userMessage.trim();

    if (!query) {
      return buildReadEnvelope({
        toolName: 'get_medical_knowledge',
        query: { medicineQuery: query },
        result: {
          knowledge: [],
          disclaimer: this.i18n.t('assistant.medical_knowledge_disclaimer', {
            lang: context.locale,
          }),
        },
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
        result: {
          knowledge: [],
          disclaimer: this.i18n.t('assistant.medical_knowledge_disclaimer', {
            lang: context.locale,
          }),
        },
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
        result: {
          knowledge: [],
          disclaimer: this.i18n.t('assistant.medical_knowledge_disclaimer', {
            lang: context.locale,
          }),
        },
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
        disclaimer: this.i18n.t('assistant.medical_knowledge_disclaimer', {
          lang: context.locale,
        }),
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
}
