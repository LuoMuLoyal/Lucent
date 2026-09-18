import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import type {
  AssistantReadResultEnvelope,
  AssistantToolExecutionContext,
} from '../../types/assistant.types.js';
import { buildReadEnvelope } from '../presenters.js';
import { LightragClientService } from '../retrieval/lightrag-client.service.js';
import type {
  LightragCallFailure,
  LightragQueryMode,
  LightragSource,
} from '../retrieval/lightrag.types.js';
import {
  LIGHTRAG_DEFAULT_LIMIT,
  LIGHTRAG_DEFAULT_MODE,
  LIGHTRAG_MAX_LIMIT,
  LIGHTRAG_QUERY_MODES,
  LIGHTRAG_SOURCES,
  LIGHTRAG_SOURCES_WITHOUT_GRAPH,
} from '../retrieval/lightrag.types.js';

/** 该工具在 `source` 判定前拒绝非法入参的统一前缀。 */
const INVALID_ARGUMENT_PREFIX =
  'Invalid search_cn_medicine_knowledge arguments';

/**
 * 中文散文检索工具：把说明书字段级检索与医学问答**都**交给 LightRAG（计划 §一）。
 *
 * 这一层的职责边界很明确 —— 它是唯一知道"哪些组合允许"的地方：
 *
 * 1. `source` 由模型给出，但 **workspace 由服务端映射**（模型不能直接指定
 *    workspace 名）：模型一旦能指定 workspace，就能跨库检索，`leaflet` 与 `qa`
 *    的证据分层立刻失效（计划 §5.3.1）。
 * 2. `qa` 与（评测前的）`leaflet` 都只接受 `naive`：没建图时 `local/global/mix`
 *    拿不到实体，下场是空结果；与其返回空，不如拒绝并给出原因（计划 §5.3.2/§5.3.3）。
 * 3. `bypass` 与其它非法 mode 在参数边界就被拒（计划 §5.3.4）。
 * 4. `verifiability` 由服务端按 `source` 写入，不由上游给（计划 §5.3.6）。
 */
@Injectable()
export class AssistantToolKnowledgeRetrievalService {
  private readonly logger = new Logger(
    AssistantToolKnowledgeRetrievalService.name,
  );

  private readonly leafletWorkspace: string;
  private readonly qaWorkspace: string;

  constructor(
    private readonly lightrag: LightragClientService,
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
  ) {
    this.leafletWorkspace =
      this.configService.get<string>(EnvKey.LIGHTRAG_WORKSPACE_LEAFLET) ??
      'leaflet';
    this.qaWorkspace =
      this.configService.get<string>(EnvKey.LIGHTRAG_WORKSPACE_QA) ?? 'qa';
  }

  async searchCnMedicineKnowledge(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const parsed = this.parseArguments(context);

    if (!parsed.ok) {
      return this.buildEmptyEnvelope({
        context,
        query: parsed.query,
        source: parsed.source,
        mode: null,
        reason: parsed.reason,
        verifiability: 'unavailable',
        tables: [],
        confidenceReason: parsed.reason,
      });
    }

    const { query, source, mode, limit } = parsed;
    const workspace =
      source === 'leaflet' ? this.leafletWorkspace : this.qaWorkspace;
    const tables = [`${workspace}:lightrag_chunks`];

    const outcome = await this.lightrag.query({
      workspace,
      query,
      mode,
      limit,
    });

    if (!outcome.ok) {
      return this.buildFailureEnvelope({
        context,
        query,
        source,
        mode,
        failure: outcome.failure,
        tables,
      });
    }

    if (outcome.value.chunks.length === 0) {
      return this.buildEmptyEnvelope({
        context,
        query,
        source,
        mode,
        reason:
          'No relevant Chinese medicine knowledge was found for this query.',
        verifiability: this.resolveVerifiability(source),
        tables,
        confidenceReason: 'No matching knowledge chunks.',
      });
    }

    const chunks = outcome.value.chunks.slice(0, limit).map((chunk) => ({
      text: chunk.text,
      rank: chunk.rank,
      score: chunk.score,
      leafletId: chunk.leafletId,
      sourceField: chunk.sourceField,
      qaId: chunk.qaId,
      verifiability: this.resolveVerifiability(source),
      sourceNote: this.resolveSourceNote(source),
    }));

    // 至少一条命中解析不出身份（doc id 既非 `leaflet:` 也非 `qa:`）时，溯源链是断的
    // ——明确标 partial，让模型知道"有证据但不都能追回原文"，而不是假装完整（计划 §5.4）。
    // 注意：`qa` 命中没有 leafletId 属正常（问答本就没有说明书身份），不算未映射。
    const coveragePartial = outcome.value.hasUnmappedChunk;

    return buildReadEnvelope({
      toolName: 'search_cn_medicine_knowledge',
      query: { medicineQuery: query, source, mode },
      result: {
        chunks,
        source,
        mode,
        disclaimer: this.i18n.t('assistant.medical_knowledge_disclaimer', {
          lang: context.locale,
        }),
      },
      coverage: coveragePartial
        ? {
            status: 'partial',
            reason:
              'Some retrieved chunks could not be traced back to a leaflet record.',
          }
        : { status: 'complete', reason: null },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: {
        level: coveragePartial ? 'medium' : 'high',
        reason:
          'Retrieved Chinese prose evidence via LightRAG semantic search.',
      },
      ambiguities: [],
      tables,
    });
  }

  /**
   * 解析并**校验**模型给的参数。
   *
   * 返回判别式联合而不是抛异常：非法参数是一个正常的"模型给错了"情形，应该变成
   * 一个可读的空信封让模型自我纠正，而不是把整条 graph 打挂。
   */
  private parseArguments(context: AssistantToolExecutionContext):
    | {
        ok: true;
        query: string;
        source: LightragSource;
        mode: LightragQueryMode;
        limit: number;
      }
    | {
        ok: false;
        query: string;
        source: LightragSource | null;
        reason: string;
      } {
    const args = context.toolArgs ?? {};
    const rawQuery = typeof args['query'] === 'string' ? args['query'] : '';
    const query = rawQuery.trim();
    const rawSource = typeof args['source'] === 'string' ? args['source'] : '';

    if (!isLightragSource(rawSource)) {
      return {
        ok: false,
        query,
        source: null,
        reason: `${INVALID_ARGUMENT_PREFIX}: "source" must be one of ${LIGHTRAG_SOURCES.join(', ')}.`,
      };
    }

    if (query.length === 0) {
      return {
        ok: false,
        query,
        source: rawSource,
        reason: `${INVALID_ARGUMENT_PREFIX}: "query" must not be empty.`,
      };
    }

    const mode = this.parseMode(args['mode'], rawSource);
    if (!mode.ok) {
      return { ok: false, query, source: rawSource, reason: mode.reason };
    }

    return {
      ok: true,
      query,
      source: rawSource,
      mode: mode.mode,
      limit: normalizeLimit(args['limit']),
    };
  }

  /**
   * mode 的白名单校验：**显式拒绝** `bypass` 与未知值。
   *
   * 未知值不静默回落到默认模式 —— "模型说了个我们不认识的东西"与"模型没说话"
   * 是两回事，前者应该让模型看见自己的错误。
   */
  private parseMode(
    raw: unknown,
    source: LightragSource,
  ): { ok: true; mode: LightragQueryMode } | { ok: false; reason: string } {
    if (raw == null) {
      return { ok: true, mode: LIGHTRAG_DEFAULT_MODE };
    }

    // `bypass` 单独先判：它不在白名单里，若漏掉这一步就会落进"未知 mode"的
    // 通用分支——虽然同样被拒，但原因读起来像笔误，而实际它是一个必须点名拒绝的
    // 危险模式（绕过检索直接问 LLM，会绕开 Lucent 的安全层）。
    if (raw === 'bypass') {
      return {
        ok: false,
        reason: `${INVALID_ARGUMENT_PREFIX}: "bypass" mode is not allowed.`,
      };
    }

    if (typeof raw !== 'string' || !isLightragQueryMode(raw)) {
      return {
        ok: false,
        reason: `${INVALID_ARGUMENT_PREFIX}: "mode" must be one of ${LIGHTRAG_QUERY_MODES.join(', ')}.`,
      };
    }

    if (raw !== 'naive' && LIGHTRAG_SOURCES_WITHOUT_GRAPH.includes(source)) {
      return {
        ok: false,
        reason: `${INVALID_ARGUMENT_PREFIX}: mode "${raw}" requires a knowledge graph, which is not built for source "${source}"; use "naive".`,
      };
    }

    return { ok: true, mode: raw };
  }

  private buildEmptyEnvelope(input: {
    context: AssistantToolExecutionContext;
    query: string;
    source: LightragSource | null;
    mode: LightragQueryMode | null;
    reason: string;
    verifiability: string;
    tables: string[];
    confidenceReason: string;
  }): AssistantReadResultEnvelope {
    return buildReadEnvelope({
      toolName: 'search_cn_medicine_knowledge',
      query: {
        medicineQuery: input.query,
        source: input.source,
        mode: input.mode,
      },
      result: {
        chunks: [],
        source: input.source,
        mode: input.mode,
        verifiability: input.verifiability,
        disclaimer: this.i18n.t('assistant.medical_knowledge_disclaimer', {
          lang: input.context.locale,
        }),
      },
      coverage: { status: 'empty', reason: input.reason },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: { level: 'low', reason: input.confidenceReason },
      ambiguities: [],
      tables: input.tables,
    });
  }

  /**
   * 检索服务不可用时的信封。
   *
   * `coverage.reason` **必须**说清是"服务不可用"而不是"没有证据"：把超时/5xx
   * 伪装成空结果会让模型把"查不到"说成结论，这是本模块反复出现过的错误
   * （计划 §5.3.7）。
   */
  private buildFailureEnvelope(input: {
    context: AssistantToolExecutionContext;
    query: string;
    source: LightragSource;
    mode: LightragQueryMode;
    failure: LightragCallFailure;
    tables: string[];
  }): AssistantReadResultEnvelope {
    this.logger.warn(
      `LightRAG retrieval failed (kind=${input.failure.kind}, source=${input.source}): ${input.failure.reason}`,
    );

    return this.buildEmptyEnvelope({
      context: input.context,
      query: input.query,
      source: input.source,
      mode: input.mode,
      reason: `Chinese medicine knowledge retrieval is unavailable: ${input.failure.reason}`,
      verifiability: 'unavailable',
      tables: input.tables,
      confidenceReason: 'Retrieval service unavailable — no evidence was read.',
    });
  }

  /**
   * 可信度标注由服务端按 source 写入（计划 §5.3.6）。
   *
   * `qa` 是开放语料（低可信教育参考，无独立可验证来源），沿用旧医学问答工具
   * 就已使用的 `open_corpus` 标注——客户端按它渲染低可信提示，改值会让前端
   * 静默失去这个提示；`leaflet` 是药品说明书，属可溯源的表内证据。
   */
  private resolveVerifiability(source: LightragSource): string {
    return source === 'qa' ? 'open_corpus' : 'citable';
  }

  private resolveSourceNote(source: LightragSource): string | null {
    return source === 'qa' ? '开放语料,低可信教育参考,无独立可验证来源' : null;
  }
}

function isLightragSource(value: string): value is LightragSource {
  return (LIGHTRAG_SOURCES as readonly string[]).includes(value);
}

function isLightragQueryMode(value: string): value is LightragQueryMode {
  return (LIGHTRAG_QUERY_MODES as readonly string[]).includes(value);
}

function normalizeLimit(limit: unknown): number {
  if (typeof limit !== 'number' || Number.isNaN(limit)) {
    return LIGHTRAG_DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(LIGHTRAG_MAX_LIMIT, Math.trunc(limit)));
}
