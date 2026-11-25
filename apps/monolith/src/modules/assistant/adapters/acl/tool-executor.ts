import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../../../config/runtime/runtime-config.types.js';
import type {
  AssistantToolCall,
  AssistantToolExecutionContext,
  AssistantToolExecutionResult,
} from '../../application/ports/assistant.js';
import type { ToolName } from '../../domain/policies/tool-permission.js';
import { READ_TOOL_NAMES } from '../../domain/policies/tool-permission.js';
import {
  AMAP_MCP_SERVER_NAME,
  externalRemoteName,
  externalToolName,
  isExternalLoaderName,
  isExternalToolName,
} from '../../domain/mcp/external-tools.js';
import {
  ASSISTANT_EXTERNAL_MCP,
  type ExternalMcpPort,
} from '../../application/ports/external-mcp.js';
import {
  ONTOLOGY_TOOL_EXECUTION_TIMEOUT_MS,
  RETRIEVAL_TOOL_EXECUTION_TIMEOUT_MS,
  TOOL_EXECUTION_TIMEOUT_MS,
} from './tools/shared/tool-constants.js';
import { AssistantToolKnowledgeRetrievalService } from './tools/retrieval/knowledge.service.js';
import {
  AssistantToolDrugbankEntityResolveService,
  parseSearchPayload,
} from './tools/drugbank/entity-resolve.service.js';
import { AssistantToolDrugbankSearchService } from './tools/drugbank/search.service.js';
import { AssistantToolMedicineLookupService } from './tools/medicine/lookup.service.js';
import { AssistantToolOnsidesService } from './tools/medicine/onsides.service.js';
import { AssistantToolOntologyReasoningService } from './tools/ontology/ontology-reasoning.service.js';
import { AssistantToolRuleReasoningService } from './tools/ontology/rule-reasoning.service.js';
import { AssistantToolProposalService } from './tools/proposal/proposal.service.js';
import { AssistantToolReadService } from './tools/read/read.service.js';
import { MetricsService } from '../../../../common/metrics/metrics.service.js';
import { makeShortHash } from '../../../../common/helpers/infra/hash.utils.js';

/**
 * Retrieval tools whose results are public medicine knowledge (no user data).
 * Their results are cached per (tool, locale, query) so repeated medicine
 * lookups skip the underlying vector search / DB reads.
 */
const KNOWLEDGE_TOOL_NAMES = new Set<ToolName>([
  'search_cn_products',
  'get_cn_product_detail',
  'search_cn_knowledge',
  'resolve_drugbank',
  'get_drugbank_detail',
  'search_drugbank',
  'search_adverse_reactions',
  'reason_ontology',
  'reason_rules',
]);

/** TTL for tool-level retrieval caches (ms). */
const TOOL_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const TOOL_CACHE_KEY_PREFIX = 'assistant:tool';

/**
 * Read-only tool names, as a Set for O(1) classification of tools eligible
 * for parallel execution (F-6). Derived from the shared tuple.
 */
const READ_TOOL_NAME_SET = new Set<ToolName>(READ_TOOL_NAMES);

/**
 * 单工具超时覆盖：默认 {@link TOOL_EXECUTION_TIMEOUT_MS}，只有需要在一次调用里
 * 跑多轮模型往返的工具才例外（`reason_ontology`，见该常量的说明）。
 *
 * 每项同时给出快照键与代码基线：快照里没有覆盖时用基线，键只在白名单里出现
 * 一次，新增工具时不会漏接。
 */
/** The three budget keys a tool can be bound to (kept narrow so reads stay `number`). */
type ToolTimeoutKey =
  | typeof EnvKey.ASSISTANT_TOOL_TIMEOUT_MS
  | typeof EnvKey.ASSISTANT_ONTOLOGY_TOOL_TIMEOUT_MS
  | typeof EnvKey.ASSISTANT_RETRIEVAL_TOOL_TIMEOUT_MS;

const TOOL_TIMEOUT_OVERRIDES: Partial<
  Record<ToolName, { key: ToolTimeoutKey; fallback: number }>
> = {
  reason_ontology: {
    key: EnvKey.ASSISTANT_ONTOLOGY_TOOL_TIMEOUT_MS,
    fallback: ONTOLOGY_TOOL_EXECUTION_TIMEOUT_MS,
  },
  // 规则推理不走模型往返（规则与查询都是显式给的），但它在服务端要做一次不动点
  // ——比一次 Cypher 读图贵得多。用同一个覆盖值，是因为瓶颈从"生成"换成了"推导"，
  // 量级相同；默认的 15s 对两者都太短。
  reason_rules: {
    key: EnvKey.ASSISTANT_ONTOLOGY_TOOL_TIMEOUT_MS,
    fallback: ONTOLOGY_TOOL_EXECUTION_TIMEOUT_MS,
  },
  // 中文散文检索：`naive` 只要 352ms，但图模式要现调 LLM 抽关键词再遍历图，
  // 实测 16–29 秒。工具级预算必须容得下最慢的那条路，否则"能用的模式"会被判死。
  search_cn_knowledge: {
    key: EnvKey.ASSISTANT_RETRIEVAL_TOOL_TIMEOUT_MS,
    fallback: RETRIEVAL_TOOL_EXECUTION_TIMEOUT_MS,
  },
};

@Injectable()
export class AssistantToolService {
  private readonly logger = new Logger(AssistantToolService.name);

  constructor(
    private readonly readService: AssistantToolReadService,
    private readonly knowledgeRetrievalService: AssistantToolKnowledgeRetrievalService,
    private readonly drugbankEntityResolveService: AssistantToolDrugbankEntityResolveService,
    private readonly drugbankSearchService: AssistantToolDrugbankSearchService,
    private readonly medicineLookupService: AssistantToolMedicineLookupService,
    private readonly onsidesService: AssistantToolOnsidesService,
    private readonly ontologyReasoningService: AssistantToolOntologyReasoningService,
    private readonly ruleReasoningService: AssistantToolRuleReasoningService,
    private readonly proposalService: AssistantToolProposalService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly metricsService: MetricsService,
    @Optional()
    @Inject(RuntimeConfigService)
    private readonly runtimeConfig?: RuntimeConfigPort,
    /**
     * The remote-map client. `@Optional()` because the existing unit tests build
     * this service without one; when absent, external calls return an
     * `unavailable` envelope instead of reaching the network.
     */
    @Optional()
    @Inject(ASSISTANT_EXTERNAL_MCP)
    private readonly amapMcpClient?: ExternalMcpPort,
  ) {}

  /**
   * Tool budget for this call, resolved from the snapshot.
   *
   * Read per call so a widened budget applies to the next tool call instead of
   * the next process; the fallbacks are the same numbers the schema declares,
   * and only matter when the runtime layer is not injected (unit tests).
   */
  private resolveToolTimeoutMs(toolName: ToolName): number {
    const values = this.runtimeConfig?.getSnapshot().values;
    const override = TOOL_TIMEOUT_OVERRIDES[toolName];
    if (override != null) {
      return values?.[override.key] ?? override.fallback;
    }
    return (
      values?.[EnvKey.ASSISTANT_TOOL_TIMEOUT_MS] ?? TOOL_EXECUTION_TIMEOUT_MS
    );
  }

  /**
   * Executes the requested tools and returns results in the input order.
   *
   * Concurrency (F-6): read-only tools (see `READ_TOOL_NAMES`) run
   * in parallel since they are side-effect-free queries, while proposal tools
   * run serially to keep write-draft assembly deterministic. Every tool is
   * bounded by `TOOL_EXECUTION_TIMEOUT_MS`; a timeout yields a result
   * envelope with `{ timeout: true, reason }` instead of aborting the graph.
   */
  async executeMany(
    context: AssistantToolExecutionContext,
    toolCalls: readonly AssistantToolCall[],
  ): Promise<AssistantToolExecutionResult[]> {
    const results: Array<AssistantToolExecutionResult | undefined> = new Array<
      AssistantToolExecutionResult | undefined
    >(toolCalls.length);

    // External (remote MCP) calls are split off *before* the built-in
    // partitioning below. They are not `ToolName`s, so they must never reach
    // `executeUncached`'s exhaustive switch — and they are network calls, which
    // is a different reliability class from the in-process reads the rest of
    // this method schedules.
    const externalEntries = toolCalls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => isExternalToolName(call.name));
    if (externalEntries.length > 0) {
      const executed = await Promise.all(
        externalEntries.map(async ({ call, index }) => ({
          index,
          result: await this.executeExternal(call),
        })),
      );
      for (const { index, result } of executed) {
        results[index] = result;
      }
    }

    const builtInEntries = toolCalls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => !isExternalToolName(call.name));

    const readEntries = builtInEntries.filter(({ call }) =>
      READ_TOOL_NAME_SET.has(call.name),
    );
    const proposeEntries = builtInEntries.filter(
      ({ call }) => !READ_TOOL_NAME_SET.has(call.name),
    );

    if (readEntries.length > 0) {
      const executed = await Promise.all(
        readEntries.map(async ({ call, index }) => ({
          index,
          result: await this.executeWithTimeout(
            this.withToolArgs(context, call),
            call.name,
          ),
        })),
      );
      for (const { index, result } of executed) {
        results[index] = result;
      }
    }

    // Proposal tools stay serial.
    for (const { call, index } of proposeEntries) {
      results[index] = await this.executeWithTimeout(
        this.withToolArgs(context, call),
        call.name,
      );
    }

    return results as AssistantToolExecutionResult[];
  }

  /**
   * Runs one remote MCP tool.
   *
   * The result is an envelope rather than a thrown error in every case: a map
   * server that is down, misconfigured or slow must read to the model as
   * "unavailable", never abort the turn. `isError` from the server itself is
   * different — that is a *tool-level* outcome (unknown city, bad coordinates)
   * and rides back as ordinary data for the model to react to.
   */
  private async executeExternal(
    call: AssistantToolCall,
  ): Promise<AssistantToolExecutionResult> {
    // The loader is ours, not the remote server's: it has no wire counterpart,
    // so sending it would be an `unknown tool` error. Validating here also puts
    // the "did the server actually offer this?" check on the side that knows
    // the offered list.
    if (isExternalLoaderName(call.name)) {
      return this.executeExternalLoader(call);
    }

    if (this.amapMcpClient == null) {
      return {
        name: call.name,
        data: {
          unavailable: true,
          source: AMAP_MCP_SERVER_NAME,
          reason: 'client_not_configured',
        },
      };
    }
    const outcome = await this.amapMcpClient.callTool(
      externalRemoteName(call.name),
      call.args,
    );
    if (!outcome.ok) {
      return {
        name: call.name,
        data: {
          unavailable: true,
          source: AMAP_MCP_SERVER_NAME,
          reason: outcome.reason,
        },
      };
    }
    return {
      name: call.name,
      data: { source: AMAP_MCP_SERVER_NAME, result: outcome.content },
    };
  }

  /**
   * Validates a `load_tools` request against what the server actually offers.
   *
   * All-or-nothing, like DSH: a request naming one unknown tool loads none of
   * them. The alternative — load the valid ones and report the rest — leaves
   * the model believing a partially applied request, and it has no way to tell
   * which half landed.
   */
  private async executeExternalLoader(
    call: AssistantToolCall,
  ): Promise<AssistantToolExecutionResult> {
    const requested = call.args['tools'];
    if (!Array.isArray(requested) || requested.length === 0) {
      return {
        name: call.name,
        data: {
          error: 'invalid_request',
          reason: '`tools` must be a non-empty array of tool names.',
        },
      };
    }
    const names = requested.filter(
      (name): name is string => typeof name === 'string',
    );
    if (names.length !== requested.length) {
      return {
        name: call.name,
        data: {
          error: 'invalid_request',
          reason: '`tools` must contain only strings.',
        },
      };
    }

    if (this.amapMcpClient == null) {
      return {
        name: call.name,
        data: {
          unavailable: true,
          source: AMAP_MCP_SERVER_NAME,
          reason: 'client_not_configured',
        },
      };
    }

    const offered = await this.amapMcpClient.listTools();
    const offeredNames = new Set(
      offered.map((tool) => externalToolName(AMAP_MCP_SERVER_NAME, tool.name)),
    );
    const unknown = names.filter((name) => !offeredNames.has(name));
    if (unknown.length > 0) {
      return {
        name: call.name,
        data: {
          error: 'unknown_tool',
          reason: `MCP server ${AMAP_MCP_SERVER_NAME} does not offer ${unknown
            .map((name) => `"${name}"`)
            .join(', ')}; use names from its on-demand tool list.`,
        },
      };
    }

    // Nothing is registered here — the graph node reads the arguments and
    // writes them into `loadedExternalTools`, which is what `agent` binds from
    // on the next step.
    return {
      name: call.name,
      data: { loaded: names },
    };
  }

  /**
   * Binds the arguments the model produced for this tool call to the execution
   * context, so argument-driven tools (e.g. the meal digest window) read them
   * instead of parsing `userMessage` text.
   */
  private withToolArgs(
    context: AssistantToolExecutionContext,
    call: AssistantToolCall,
  ): AssistantToolExecutionContext {
    return { ...context, toolArgs: call.args };
  }

  /**
   * Runs one tool with a per-tool timeout. When the tool exceeds its budget
   * (`TOOL_EXECUTION_TIMEOUT_MS`, or the tool's override), a timeout envelope
   * is returned instead of the tool result — the graph keeps running and the
   * model sees the timeout inside the envelope data. The underlying execution
   * is not cancelled (JS cannot abort it); its eventual settlement is swallowed
   * so a late failure never surfaces as an unhandled rejection.
   */
  private executeWithTimeout(
    context: AssistantToolExecutionContext,
    toolName: ToolName,
  ): Promise<AssistantToolExecutionResult> {
    const startedAt = performance.now();
    const timeoutMs = this.resolveToolTimeoutMs(toolName);
    let timedOut = false;
    const execution = this.executeOne(context, toolName);
    const timeout = new Promise<AssistantToolExecutionResult>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        resolve({
          name: toolName,
          data: {
            timeout: true,
            reason: 'Tool execution timed out.',
          },
          timeout: true,
        });
      }, timeoutMs);
      // Do not keep the event loop alive just for the timeout loser.
      timer.unref();
    });
    // Safety net for the loser of the race: it is still running and may reject
    // after the timeout already won — that rejection must not become
    // unhandled. Errors that settle BEFORE the timeout still propagate through
    // the race as before.
    execution.catch((err: unknown) => {
      if (!timedOut) {
        return;
      }
      this.logger.warn(
        `Tool "${toolName}" failed after timeout (durationMs=${String(Math.round(performance.now() - startedAt))}): ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
      );
    });
    return Promise.race([execution, timeout]).then(
      (result) => {
        this.recordToolOutcome(toolName, result);
        return result;
      },
      (error: unknown) => {
        this.metricsService.recordAssistantToolExecution(toolName, 'error');
        throw error;
      },
    );
  }

  /**
   * 工具执行与"空信封"分开计数。
   *
   * 2026-10-07 的生产事故里，这两件事在指标上完全无法区分（只能去翻
   * `assistant_messages.used_tools`）：既看不出工具到底跑没跑，也看不出"服务不可用"
   * 与"确实没查到"的差别。`reason` 取固定分类，标签基数可控。
   */
  private recordToolOutcome(
    toolName: ToolName,
    result: AssistantToolExecutionResult,
  ): void {
    this.metricsService.recordAssistantToolExecution(
      toolName,
      result.timeout === true ? 'timeout' : 'ok',
    );

    const data = result.data as {
      coverage?: { status?: unknown };
      result?: { verifiability?: unknown };
    };
    const status = data.coverage?.status;
    if (status !== 'empty' && status !== 'partial') {
      return;
    }
    // 信封里 `verifiability: 'unavailable'` 表示**服务**不可用（sidecar 没配 / 连不上 /
    // 向量库缺失），与"服务好、只是没证据"必须分开看。
    this.metricsService.recordAssistantToolEmpty(
      data.result?.verifiability === 'unavailable' ? 'unavailable' : status,
    );
  }

  private async executeOne(
    context: AssistantToolExecutionContext,
    toolName: ToolName,
  ): Promise<AssistantToolExecutionResult> {
    if (KNOWLEDGE_TOOL_NAMES.has(toolName)) {
      // Key on the parsed query (plus filters, e.g. a resolved productId for
      // leaflet lookups) so different lookups never share a cached result.
      // 参数也进 key：`reason_ontology` 的问题、`search_cn_knowledge`
      // 的 source/mode 都在 toolArgs 里，只按 userMessage 建 key 会让同一条消息下
      // 两次参数不同的调用互相命中缓存，返回另一次的结果。
      const payload = parseSearchPayload(context.userMessage, this.logger);
      const keySeed = JSON.stringify({
        query: payload.query.trim().toLowerCase(),
        filters: payload.filters,
        args: context.toolArgs ?? {},
      });
      const cacheKey = `${TOOL_CACHE_KEY_PREFIX}:${toolName}:${context.locale}:${makeShortHash(keySeed)}`;

      const cached = await this.cacheGet<string>(cacheKey);
      if (cached != null) {
        try {
          const result = JSON.parse(cached) as AssistantToolExecutionResult;
          this.metricsService.recordCacheAccess('tool', true);
          return result;
        } catch (error) {
          // Corrupted cache entry: fall through and re-execute.
          this.logger.warn(
            `Corrupted tool cache entry, falling through to re-execute: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      this.metricsService.recordCacheAccess('tool', false);

      const result = await this.executeUncached(context, toolName);
      await this.cacheSet(cacheKey, JSON.stringify(result), TOOL_CACHE_TTL_MS);
      return result;
    }

    return this.executeUncached(context, toolName);
  }

  /**
   * Cache get with error protection — a Redis failure degrades to a cache
   * miss (returns `undefined`) so the tool still executes uncached.
   */
  private async cacheGet<T>(key: string): Promise<T | undefined> {
    try {
      return await this.cache.get<T>(key);
    } catch (error) {
      this.logger.warn(
        `Assistant tool cache get failed (key=${key}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  /**
   * Cache set with error protection — a Redis failure is logged and
   * swallowed so the tool result is still returned to the caller.
   */
  private async cacheSet(
    key: string,
    value: string,
    ttl: number,
  ): Promise<void> {
    try {
      await this.cache.set(key, value, ttl);
    } catch (error) {
      this.logger.warn(
        `Assistant tool cache set failed (key=${key}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async executeUncached(
    context: AssistantToolExecutionContext,
    toolName: ToolName,
  ): Promise<AssistantToolExecutionResult> {
    switch (toolName) {
      case 'get_today_records':
        return {
          name: toolName,
          data: await this.readService.getTodayRecords(context),
        };
      case 'get_records_by_date':
        return {
          name: toolName,
          data: await this.readService.getRecordsByDate(context),
        };
      case 'get_records_by_range':
        return {
          name: toolName,
          data: await this.readService.getRecordsByRange(context),
        };
      case 'get_today_summary':
        return {
          name: toolName,
          data: await this.readService.getTodaySummaryByDate(context),
        };
      case 'get_report_summary':
        return {
          name: toolName,
          data: await this.readService.getReportSummaryByRange(context),
        };
      case 'get_today_summaries':
        return {
          name: toolName,
          data: await this.readService.getRecentTodaySummaries(context),
        };
      case 'get_report_summaries':
        return {
          name: toolName,
          data: await this.readService.getRecentReportSummaries(context),
        };
      case 'get_user_profile':
        return {
          name: toolName,
          data: await this.readService.getUserProfile(context),
        };
      case 'get_user_settings':
        return {
          name: toolName,
          data: await this.readService.getUserSettings(context),
        };
      case 'get_medicines':
        return {
          name: toolName,
          data: await this.readService.getCurrentMedicines(context),
        };
      case 'get_sleep_summary':
        return {
          name: toolName,
          data: await this.readService.getSleepSummaryByRange(context),
        };
      case 'get_meal_digest':
        return {
          name: toolName,
          data: await this.readService.getMealAnalysisDigest(context),
        };
      case 'search_cn_products':
        return {
          name: toolName,
          data: await this.medicineLookupService.searchCnMedicineProducts(
            context,
          ),
        };
      case 'get_cn_product_detail':
        return {
          name: toolName,
          data: await this.medicineLookupService.getCnMedicineDetail(context),
        };
      case 'search_cn_knowledge':
        return {
          name: toolName,
          data: await this.knowledgeRetrievalService.searchCnMedicineKnowledge(
            context,
          ),
        };
      case 'resolve_drugbank':
        return {
          name: toolName,
          data: await this.drugbankEntityResolveService.resolve(context),
        };
      case 'get_drugbank_detail':
        return {
          name: toolName,
          data: await this.medicineLookupService.getDrugbankDetail(context),
        };
      case 'search_drugbank':
        return {
          name: toolName,
          data: await this.drugbankSearchService.search(context),
        };
      case 'search_adverse_reactions':
        return {
          name: toolName,
          data: await this.onsidesService.search(context),
        };
      case 'reason_ontology':
        return {
          name: toolName,
          data: await this.ontologyReasoningService.reasonOverOntology(context),
        };
      case 'reason_rules':
        return {
          name: toolName,
          data: await this.ruleReasoningService.reasonOverRules(context),
        };
      case 'create_record_draft':
        return this.proposalService.buildCreateDailyRecordProposal(
          context,
          toolName,
        );
      case 'update_record_draft':
        return this.proposalService.buildUpdateDailyRecordProposal(
          context,
          toolName,
        );
      case 'delete_record_draft':
        return this.proposalService.buildDeleteDailyRecordProposal(
          context,
          toolName,
        );
      case 'update_settings_draft':
        return this.proposalService.buildUpdateUserSettingsProposal(
          context,
          toolName,
        );
    }
  }
}
