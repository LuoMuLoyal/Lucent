import { Injectable, Logger } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
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
  MEDICAL_QA_MAX_LIMIT,
} from '../shared/tool-constants';

const EMBEDDINGS_TABLE = 'medical_qa_embeddings';

/**
 * The alpaca_zh_demo.json source carries no structured provenance fields
 * (embed metadata is only qaId/question/safetyLabel), so every retrieved
 * chunk is uniformly tagged as an open corpus of low-trust educational
 * reference. Markers are generated here at the chunk-mapping layer — no DB
 * or import-script change.
 */
const OPEN_CORPUS_VERIFIABILITY = 'open_corpus' as const;
const OPEN_CORPUS_SOURCE_NOTE = '开放语料,低可信教育参考,无独立可验证来源';

@Injectable()
export class AssistantToolMedicalKnowledgeService {
  private readonly logger = new Logger(
    AssistantToolMedicalKnowledgeService.name,
  );

  constructor(
    private readonly vectorStoreFactory: VectorStoreFactory,
    private readonly i18n: I18nService,
  ) {}

  async searchMedicalQaCorpus(
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
      verifiability: OPEN_CORPUS_VERIFIABILITY,
      sourceNote: OPEN_CORPUS_SOURCE_NOTE,
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
    return Math.min(ASSISTANT_VECTOR_DEFAULT_LIMIT, MEDICAL_QA_MAX_LIMIT);
  return Math.max(1, Math.min(MEDICAL_QA_MAX_LIMIT, Math.trunc(limit)));
}
