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
    const args = context.toolArgs ?? {};
    // 模型参数优先：`query` 是"检索什么内容"，药品身份由 `drugbankId` / `drugName` 给。
    // 回退 `userMessage` 只为不打断未声明参数的旧路径 —— 整句既当检索词又当药品名，
    // 作用域必然解析不出来（2026-10-07 生产实测）。
    const query = firstNonEmptyString(args['query']) ?? payload.query.trim();
    const requestedDrugbankId =
      firstNonEmptyString(args['drugbankId']) ??
      firstNonEmptyString(payload.filters['drugbankId']);

    if (!query) {
      return this.buildEmptyEnvelope(
        'No DrugBank search query was provided; pass a non-empty "query" argument.',
      );
    }

    const resolvedDrugbankId =
      requestedDrugbankId ??
      (await this.resolveSingleDrugbankId(
        context,
        firstNonEmptyString(args['drugName']) ??
          firstNonEmptyString(args['query']),
      ));

    if (!resolvedDrugbankId) {
      return this.buildEmptyEnvelope(
        'DrugBank passage search requires one resolved DrugBank entity scope; ' +
          'pass "drugbankId", or a "query" that resolves to exactly one drug name.',
      );
    }

    const store = await this.vectorStoreFactory.getStore(
      DRUGBANK_EMBEDDINGS_TABLE,
    );
    if (!store) {
      this.logger.warn(
        `DrugBank passage search is unavailable: vector store "${DRUGBANK_EMBEDDINGS_TABLE}" is not configured.`,
      );
      return this.buildEmptyEnvelope(
        'DrugBank vector search is not configured.',
        { verifiability: 'unavailable' },
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
        { resolvedDrugbankId },
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
    drugName: string | null,
  ): Promise<string | null> {
    // 把"药品名"当 `query` 交给解析服务（它优先读 `toolArgs.query`），而不是让解析
    // 服务去读整句用户消息 —— 后者是本条链路长期返回空的直接原因。
    const resolveContext: AssistantToolExecutionContext =
      drugName == null
        ? context
        : {
            ...context,
            toolArgs: { ...(context.toolArgs ?? {}), query: drugName },
          };
    const resolution =
      await this.drugbankEntityResolveService.resolve(resolveContext);
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
    options: {
      resolvedDrugbankId?: string | null;
      verifiability?: 'citable' | 'unavailable';
    } = {},
  ): AssistantReadResultEnvelope {
    const resolvedDrugbankId = options.resolvedDrugbankId ?? null;
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
        // 与 `tools/retrieval/knowledge.service.ts` 同一条纪律：**服务不可用**与
        // **没有证据**必须能被区分开。旧实现把两者都做成 `coverage.empty`，模型
        // 读起来一模一样，于是"向量库没配好"被说成"数据里没有段落"。
        verifiability: options.verifiability ?? 'citable',
      },
      coverage: { status: 'empty', reason },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: {
        level: 'low',
        reason:
          options.verifiability === 'unavailable'
            ? 'Retrieval service unavailable — no evidence was read.'
            : 'No DrugBank scientific passage evidence was retrieved.',
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

/** 取模型参数里的非空字符串；空串/空白/非字符串都当"没给"。 */
function firstNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}
