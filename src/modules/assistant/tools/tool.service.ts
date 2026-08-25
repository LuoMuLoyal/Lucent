import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import type {
  AssistantToolExecutionContext,
  AssistantToolExecutionResult,
} from '../types/assistant.types';
import type { AssistantToolName } from './shared/tool-types';
import { ASSISTANT_READ_TOOL_NAMES } from './shared/tool-types';
import { TOOL_EXECUTION_TIMEOUT_MS } from './shared/tool-constants';
import { AssistantToolLeafletReadService } from './leaflet/read.service';
import {
  AssistantToolDrugbankEntityResolveService,
  parseSearchPayload,
} from './drugbank/entity-resolve.service';
import { AssistantToolDrugbankSearchService } from './drugbank/search.service';
import { AssistantToolMedicalKnowledgeService } from './knowledge/medical.service';
import { AssistantToolMedicineLookupService } from './medicine/lookup.service';
import { AssistantToolProposalService } from './proposal/proposal.service';
import { AssistantToolReadService } from './read/read.service';
import { MetricsService } from '../../../common/metrics/metrics.service';
import { makeShortHash } from '../../../common/helpers/infra/hash.utils';

/**
 * Retrieval tools whose results are public medicine knowledge (no user data).
 * Their results are cached per (tool, locale, query) so repeated medicine
 * lookups skip the underlying vector search / DB reads.
 */
const KNOWLEDGE_TOOL_NAMES = new Set<AssistantToolName>([
  'search_cn_medicine_products',
  'get_cn_medicine_detail',
  'search_medicine_leaflets',
  'search_medical_qa_corpus',
  'resolve_drugbank_entity',
  'get_drugbank_detail',
  'search_drugbank_passages',
]);

/** TTL for tool-level retrieval caches (ms). */
const TOOL_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Read-only tool names, as a Set for O(1) classification of tools eligible
 * for parallel execution (F-6). Derived from the shared tuple.
 */
const READ_TOOL_NAMES = new Set<AssistantToolName>(ASSISTANT_READ_TOOL_NAMES);

@Injectable()
export class AssistantToolService {
  private readonly logger = new Logger(AssistantToolService.name);

  constructor(
    private readonly readService: AssistantToolReadService,
    private readonly leafletReadService: AssistantToolLeafletReadService,
    private readonly medicalKnowledgeService: AssistantToolMedicalKnowledgeService,
    private readonly drugbankEntityResolveService: AssistantToolDrugbankEntityResolveService,
    private readonly drugbankSearchService: AssistantToolDrugbankSearchService,
    private readonly medicineLookupService: AssistantToolMedicineLookupService,
    private readonly proposalService: AssistantToolProposalService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Executes the requested tools and returns results in the input order.
   *
   * Concurrency (F-6): read-only tools (see `ASSISTANT_READ_TOOL_NAMES`) run
   * in parallel since they are side-effect-free queries, while proposal tools
   * run serially to keep write-draft assembly deterministic. Every tool is
   * bounded by `TOOL_EXECUTION_TIMEOUT_MS`; a timeout yields a result
   * envelope with `{ timeout: true, reason }` instead of aborting the graph.
   *
   * `search_medicine_leaflets` is the one read tool with an in-batch
   * dependency: it consumes the resolved CN product id produced by
   * `get_cn_medicine_detail`, so it executes after the parallel read batch
   * with the finished results available for context building.
   */
  async executeMany(
    context: AssistantToolExecutionContext,
    toolNames: readonly AssistantToolName[],
  ): Promise<AssistantToolExecutionResult[]> {
    const results: Array<AssistantToolExecutionResult | undefined> = new Array<
      AssistantToolExecutionResult | undefined
    >(toolNames.length);

    const readEntries = toolNames
      .map((name, index) => ({ name, index }))
      .filter(({ name }) => READ_TOOL_NAMES.has(name));
    const proposeEntries = toolNames
      .map((name, index) => ({ name, index }))
      .filter(({ name }) => !READ_TOOL_NAMES.has(name));

    // Read tools (except leaflet) run concurrently.
    const parallelReads = readEntries.filter(
      ({ name }) => name !== 'search_medicine_leaflets',
    );
    if (parallelReads.length > 0) {
      const executed = await Promise.all(
        parallelReads.map(async ({ name, index }) => ({
          index,
          result: await this.executeWithTimeout(context, name),
        })),
      );
      for (const { index, result } of executed) {
        results[index] = result;
      }
    }

    // Leaflet runs after the parallel batch so its product-id context can see
    // the finished `get_cn_medicine_detail` result.
    const leafletEntry = readEntries.find(
      ({ name }) => name === 'search_medicine_leaflets',
    );
    if (leafletEntry != null) {
      const filled = results.filter(
        (result): result is AssistantToolExecutionResult => result != null,
      );
      const leafletContext = this.buildToolContext(
        context,
        'search_medicine_leaflets',
        filled,
      );
      results[leafletEntry.index] = await this.executeWithTimeout(
        leafletContext,
        'search_medicine_leaflets',
      );
    }

    // Proposal tools stay serial.
    for (const { name, index } of proposeEntries) {
      results[index] = await this.executeWithTimeout(context, name);
    }

    return results as AssistantToolExecutionResult[];
  }

  /**
   * Runs one tool with a per-tool timeout. When the tool exceeds
   * `TOOL_EXECUTION_TIMEOUT_MS`, a timeout envelope is returned instead of the
   * tool result — the graph keeps running and the model sees the timeout
   * inside the envelope data. The underlying execution is not cancelled (JS
   * cannot abort it); its eventual settlement is swallowed so a late failure
   * never surfaces as an unhandled rejection.
   */
  private executeWithTimeout(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): Promise<AssistantToolExecutionResult> {
    const startedAt = performance.now();
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
      }, TOOL_EXECUTION_TIMEOUT_MS);
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
    return Promise.race([execution, timeout]);
  }

  private buildToolContext(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
    previousResults: readonly AssistantToolExecutionResult[],
  ): AssistantToolExecutionContext {
    if (toolName !== 'search_medicine_leaflets') {
      return context;
    }

    const productId = this.readResolvedCnProductId(previousResults);
    if (productId == null) {
      return context;
    }

    const payload = parseSearchPayload(context.userMessage);
    return {
      ...context,
      userMessage: JSON.stringify({
        query: payload.query,
        ...(payload.limit != null ? { limit: payload.limit } : {}),
        ...(payload.cursor != null ? { cursor: payload.cursor } : {}),
        filters: {
          ...payload.filters,
          productId,
        },
      }),
    };
  }

  private readResolvedCnProductId(
    results: readonly AssistantToolExecutionResult[],
  ): string | null {
    const detailResult = [...results]
      .reverse()
      .find((result) => result.name === 'get_cn_medicine_detail');
    const resultEnvelope = detailResult?.data['result'];
    if (resultEnvelope == null || typeof resultEnvelope !== 'object') {
      return null;
    }

    const product = (resultEnvelope as Record<string, unknown>)['product'];
    if (product == null || typeof product !== 'object') {
      return null;
    }

    const productId = (product as Record<string, unknown>)['id'];
    return typeof productId === 'string' && productId.trim().length > 0
      ? productId
      : null;
  }

  private async executeOne(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): Promise<AssistantToolExecutionResult> {
    if (KNOWLEDGE_TOOL_NAMES.has(toolName)) {
      // Key on the parsed query (plus filters, e.g. a resolved productId for
      // leaflet lookups) so different lookups never share a cached result.
      const payload = parseSearchPayload(context.userMessage);
      const keySeed = JSON.stringify({
        query: payload.query.trim().toLowerCase(),
        filters: payload.filters,
      });
      const cacheKey = `assistant:tool:${toolName}:${context.locale}:${makeShortHash(keySeed)}`;

      const cached = await this.cacheGet<string>(cacheKey);
      if (cached != null) {
        try {
          const result = JSON.parse(cached) as AssistantToolExecutionResult;
          this.metricsService.recordCacheAccess('tool', true);
          return result;
        } catch {
          // Corrupted cache entry: fall through and re-execute.
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
    toolName: AssistantToolName,
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
      case 'get_today_summary_by_date':
        return {
          name: toolName,
          data: await this.readService.getTodaySummaryByDate(context),
        };
      case 'get_report_summary_by_range':
        return {
          name: toolName,
          data: await this.readService.getReportSummaryByRange(context),
        };
      case 'get_recent_today_summaries':
        return {
          name: toolName,
          data: await this.readService.getRecentTodaySummaries(context),
        };
      case 'get_recent_report_summaries':
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
      case 'get_current_medicines':
        return {
          name: toolName,
          data: await this.readService.getCurrentMedicines(context),
        };
      case 'get_sleep_summary_by_range':
        return {
          name: toolName,
          data: await this.readService.getSleepSummaryByRange(context),
        };
      case 'search_cn_medicine_products':
        return {
          name: toolName,
          data: await this.medicineLookupService.searchCnMedicineProducts(
            context,
          ),
        };
      case 'get_cn_medicine_detail':
        return {
          name: toolName,
          data: await this.medicineLookupService.getCnMedicineDetail(context),
        };
      case 'search_medicine_leaflets':
        return {
          name: toolName,
          data: await this.leafletReadService.searchMedicineLeaflets(context),
        };
      case 'search_medical_qa_corpus':
        return {
          name: toolName,
          data: await this.medicalKnowledgeService.searchMedicalQaCorpus(
            context,
          ),
        };
      case 'resolve_drugbank_entity':
        return {
          name: toolName,
          data: await this.drugbankEntityResolveService.resolve(context),
        };
      case 'get_drugbank_detail':
        return {
          name: toolName,
          data: await this.medicineLookupService.getDrugbankDetail(context),
        };
      case 'search_drugbank_passages':
        return {
          name: toolName,
          data: await this.drugbankSearchService.search(context),
        };
      case 'propose_create_daily_record':
        return this.proposalService.buildCreateDailyRecordProposal(
          context,
          toolName,
        );
      case 'propose_update_daily_record':
        return this.proposalService.buildUpdateDailyRecordProposal(
          context,
          toolName,
        );
      case 'propose_delete_daily_record':
        return this.proposalService.buildDeleteDailyRecordProposal(
          context,
          toolName,
        );
      case 'propose_update_user_settings':
        return this.proposalService.buildUpdateUserSettingsProposal(
          context,
          toolName,
        );
    }
  }
}
