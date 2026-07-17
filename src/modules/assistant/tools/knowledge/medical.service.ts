import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { VectorStoreFactory } from '../vector-store.factory';
import type {
  AssistantReadResultEnvelope,
  AssistantToolExecutionContext,
} from '../../types/types';
import { buildReadConfidence, buildReadEnvelope } from '../presenters';
import {
  buildVectorPage,
  buildVectorQueryHash,
  decodeVectorCursor,
} from '../vector-cursor';
import { parseSearchPayload } from '../drugbank/entity-resolve.service';
import {
  ASSISTANT_VECTOR_DEFAULT_LIMIT,
  ASSISTANT_VECTOR_MAX_LIMIT,
} from '../constants';

const EMBEDDINGS_TABLE = 'medical_qa_embeddings';

@Injectable()
export class AssistantToolMedicalKnowledgeService {
  constructor(
    private readonly vectorStoreFactory: VectorStoreFactory,
    private readonly i18n: I18nService,
  ) {}

  async searchMedicalQaCorpus(
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
      return buildReadEnvelope({
        toolName: 'search_medical_qa_corpus',
        query: { medicineQuery: query },
        result: {
          knowledge: [],
          disclaimer: this.i18n.t('assistant.medical_knowledge_disclaimer', {
            lang: context.locale,
          }),
          page: buildVectorPage({
            limit,
            offset,
            hasMore: false,
            queryHash,
          }),
        },
        coverage: { status: 'empty', reason: 'No query was provided.' },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: { level: 'low', reason: 'Empty query.' },
        ambiguities: [],
        tables: [EMBEDDINGS_TABLE],
      });
    }

    const store = await this.vectorStoreFactory.getStore(EMBEDDINGS_TABLE);
    if (!store) {
      return buildReadEnvelope({
        toolName: 'search_medical_qa_corpus',
        query: { medicineQuery: query },
        result: {
          knowledge: [],
          disclaimer: this.i18n.t('assistant.medical_knowledge_disclaimer', {
            lang: context.locale,
          }),
          page: buildVectorPage({
            limit,
            offset,
            hasMore: false,
            queryHash,
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

    const results = await store.similaritySearchWithScore(
      query,
      offset + limit + 1,
    );
    const pageResults = results.slice(offset, offset + limit);
    const hasMore = results.length > offset + limit;

    if (pageResults.length === 0) {
      return buildReadEnvelope({
        toolName: 'search_medical_qa_corpus',
        query: { medicineQuery: query },
        result: {
          knowledge: [],
          disclaimer: this.i18n.t('assistant.medical_knowledge_disclaimer', {
            lang: context.locale,
          }),
          page: buildVectorPage({
            limit,
            offset,
            hasMore: false,
            queryHash,
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

    const chunks = pageResults.map(([doc, score], index) => ({
      qaId: doc.metadata['qaId'] as string,
      question: doc.metadata['question'] as string,
      answer: doc.pageContent,
      safetyLabel: doc.metadata['safetyLabel'] as string,
      topic: (doc.metadata['topic'] as string | undefined) ?? 'general',
      rank: offset + index + 1,
      score,
    }));

    return buildReadEnvelope({
      toolName: 'search_medical_qa_corpus',
      query: { medicineQuery: query },
      result: {
        knowledge: chunks,
        disclaimer: this.i18n.t('assistant.medical_knowledge_disclaimer', {
          lang: context.locale,
        }),
        page: buildVectorPage({
          limit,
          offset,
          hasMore,
          queryHash,
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
}

function normalizeLimit(limit: number | undefined): number {
  if (limit == null || Number.isNaN(limit))
    return ASSISTANT_VECTOR_DEFAULT_LIMIT;
  return Math.max(1, Math.min(ASSISTANT_VECTOR_MAX_LIMIT, Math.trunc(limit)));
}
