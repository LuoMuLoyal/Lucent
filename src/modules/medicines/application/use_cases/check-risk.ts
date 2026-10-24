import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { LlmNotConfiguredException } from '../../../../common/llm/safety/llm-not-configured.exception.js';
import type { Cache } from 'cache-manager';
import { I18nService } from 'nestjs-i18n';
import { MedicinesService } from './medicines.js';
import { RiskDetectionService } from '../../domain/services/risk-scoring.js';
import { toInputJsonValue } from '../../../../common/index.js';
import {
  createDomainFailure,
  DomainFailureException,
  fromPromise,
  mapUnknownToInternalFailure,
  unwrapResult,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import {
  MEDICINE_RISK_RECORDS,
  type MedicineRiskRecordsPort,
  type MedicineRiskCheckRecordRow,
  type MedicineRiskCheckType,
} from '../ports/risk-records.js';
import {
  MEDICINE_RISK_LLM_GENERATOR,
  type MedicineRiskLlmContext,
  type MedicineRiskLlmOutput,
  type MedicineRiskLlmPort,
} from '../ports/risk-llm.js';
import type { RiskCheckCandidateDto } from '../../adapters/http/dto/risk-check.js';
import type {
  MedicineRiskCheckResult,
  MedicineRiskCheckRecord,
  MedicineRiskLevel,
} from '../../domain/services/risk-model.js';
import {
  asNonEmptyString,
  getDetailJson,
  type MedicineDetailDataLike,
  type MedicineDetailWrapper,
} from '../../domain/services/ingredient-canonicalization.js';
import type { AllergyRecord } from '../../domain/services/allergy-severity.js';
import type { MedicineKnowledgeSource } from '../../domain/medicine/medicine-source.js';
import { formatDateOnly } from '../../../../common/index.js';

/** Narrows a box-item `source` string to the knowledge sources this module has. */
function asKnowledgeSource(source: string): MedicineKnowledgeSource | null {
  return source === 'cn' || source === 'drugbank' ? source : null;
}

const RISK_CHECK_CACHE_KEY_PREFIX = 'medicines:risk-check';
const RISK_CHECK_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Maximum number of related records (allergies, conditions, current
 * medicines) fetched per user during a risk check. Prevents extreme data
 * volumes from causing unbounded query latency.
 */
const RISK_CHECK_MAX_RELATED_RECORDS = 100;

/**
 * The LLM context historically included *all* active rows for a user, unlike
 * the static evaluation path (bounded by RISK_CHECK_MAX_RELATED_RECORDS) — the
 * repository accepts an explicit limit, so "all" is passed as the max safe int.
 */
const LLM_CONTEXT_ROW_LIMIT = Number.MAX_SAFE_INTEGER;

@Injectable()
export class MedicineRiskCheckService {
  private readonly logger = new Logger(MedicineRiskCheckService.name);

  constructor(
    @Inject(MEDICINE_RISK_RECORDS)
    private readonly riskRecords: MedicineRiskRecordsPort,
    private readonly medicinesService: MedicinesService,
    @Inject(MEDICINE_RISK_LLM_GENERATOR)
    private readonly llmGenerator: MedicineRiskLlmPort,
    private readonly riskDetection: RiskDetectionService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly i18n: I18nService,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────

  async getRecords(userId: string): Promise<{
    static: MedicineRiskCheckRecord | null;
    llm: MedicineRiskCheckRecord | null;
  }> {
    const cacheKey = this.buildRecordsCacheKey(userId);
    let cached:
      | {
          static: MedicineRiskCheckRecord | null;
          llm: MedicineRiskCheckRecord | null;
        }
      | undefined;
    try {
      cached = await this.cache.get<{
        static: MedicineRiskCheckRecord | null;
        llm: MedicineRiskCheckRecord | null;
      }>(cacheKey);
    } catch (error) {
      // Cache get failure is non-fatal: treat as a cache miss and fall
      // through to DB read. This is consistent with cache.set below (which
      // also swallows errors) — cache is an accelerator, not a gate.
      this.logger.warn(
        `Risk-check cache get failed (key=${cacheKey}), falling through to DB: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (cached != null) {
      return cached;
    }

    const records = await this.riskRecords.listRecords(userId);

    const result = {
      static: records.find((r) => r.checkType === 'static') ?? null,
      llm: records.find((r) => r.checkType === 'llm') ?? null,
    };

    const mapped = {
      static: result.static != null ? this.toDto(result.static) : null,
      llm: result.llm != null ? this.toDto(result.llm) : null,
    };

    try {
      await this.cache.set(cacheKey, mapped, RISK_CHECK_CACHE_TTL_MS);
    } catch (error) {
      this.logger.warn(
        `Risk-check cache set failed (key=${cacheKey}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.logger.debug(`Cache set: risk-check records (userId=${userId})`);
    return mapped;
  }

  runStaticCheck(
    userId: string,
    candidate?: RiskCheckCandidateDto,
  ): ResultAsync<MedicineRiskCheckRecord, DomainFailure> {
    return fromPromise(this.doRunStaticCheck(userId, candidate), (error) =>
      this.toDomainFailure(error),
    );
  }

  private async doRunStaticCheck(
    userId: string,
    candidate?: RiskCheckCandidateDto,
  ): Promise<MedicineRiskCheckRecord> {
    const response = await this.evaluateStaticCheck(userId, candidate);

    if (candidate != null) {
      // 候选预检为即时预览，不落库；避免把未建档药品写入最新检查记录。
      const now = new Date();
      return {
        checkType: 'static',
        result: response,
        riskScore: response.overallRiskScore,
        riskLevel: response.overallRiskLevel,
        stale: false,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
    }

    return this.persistRecord(userId, 'static', response);
  }

  runLlmCheck(
    userId: string,
  ): ResultAsync<MedicineRiskCheckRecord, DomainFailure> {
    return fromPromise(this.doRunLlmCheck(userId), (error) =>
      this.toDomainFailure(error),
    );
  }

  private async doRunLlmCheck(
    userId: string,
  ): Promise<MedicineRiskCheckRecord> {
    if (!this.llmGenerator.hasAnalysisModel()) {
      // 出网 detail 交给注册表的双语文案；这里不传 detail，避免覆盖它
      // （problem-catalog 的 `options.detail ?? translate(...)` 语义）。
      this.logger.warn(
        `Risk-check LLM requested without an analysis model configured (userId=${userId})`,
      );
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'dependency',
          // 稳定码区分「这台部署没配 AI」(重试无用)与「运行时 LLM 失败」(可重试)。
          code: 'LLM_NOT_CONFIGURED',
        }),
      );
    }

    // 1. Run static check to get baseline findings
    const staticResult = await this.evaluateStaticCheck(userId);

    // 2. Build LLM context
    const llmContext = await this.buildLlmContext(userId, staticResult);

    // 3. Call LLM generator
    const llmOutput = await this.llmGenerator.generate(llmContext, {
      userIntro: '',
      tone: '',
      actionLabelHint: '',
      factsLabel: '',
    });

    // 4. Map LLM output to response DTO
    const response = this.mapLlmOutput(llmOutput, staticResult);

    // 5. Persist
    return this.persistRecord(userId, 'llm', response);
  }

  async markStale(userId: string): Promise<void> {
    await this.riskRecords.markAllStale(userId);
    // Delete Redis cache for records — next GET will re-read from DB
    await this.invalidateRecordsCache(userId);
  }

  // ── Static check logic ──────────────────────────────────────────────────

  private async evaluateStaticCheck(
    userId: string,
    candidate?: RiskCheckCandidateDto,
  ): Promise<MedicineRiskCheckResult> {
    // 1. Get health context through the records port (bound to Prisma).
    const user = await this.riskRecords.loadHealthContext(
      userId,
      RISK_CHECK_MAX_RELATED_RECORDS,
    );

    if (user == null) {
      return {
        overallRiskLevel: 'safe',
        overallRiskScore: 0,
        currentMedicineCount: 0,
        checkedMedicineCount: 0,
        findings: [],
        coverageIssues: [],
        redFlags: [],
      };
    }

    const activeAllergies: AllergyRecord[] = user.allergies.map((a) => ({
      label: a.label,
      reaction: a.reaction,
      severity: a.severity,
      isActive: a.isActive,
    }));
    const currentMedicines = user.currentMedicines;

    // 2. Fetch medicine details — parallelized to avoid N+1 latency
    const eligibleMedicines = currentMedicines.flatMap((item) => {
      const source = item.source;
      const sourceRefId = item.sourceRefId?.trim();
      if (
        (source === 'cn' || source === 'drugbank') &&
        sourceRefId != null &&
        sourceRefId !== ''
      ) {
        return [{ item, source, sourceRefId }];
      }
      return [];
    });

    const detailResults = await Promise.allSettled(
      eligibleMedicines.map(async ({ item, source, sourceRefId }) => {
        const detail = await unwrapResult(
          this.medicinesService.getDetailWithCache(
            sourceRefId,
            { source },
            false,
          ),
        );
        return {
          item: {
            id: item.id,
            source,
            sourceRefId,
            displayName: item.displayName,
            startedAt: item.startedAt,
          },
          detail,
        };
      }),
    );

    const details: MedicineDetailWrapper[] = [];
    for (const result of detailResults) {
      if (result.status === 'fulfilled') {
        details.push(result.value);
      } else {
        this.logger.warn(
          `Failed to fetch medicine detail: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        );
      }
    }

    // 2b. Candidate pre-check (加药前预检): the candidate detail is resolved
    // eagerly and must fail loudly — never silently downgraded to an uncovered
    // item (that semantics is reserved for box items whose data is temporarily
    // unavailable). If the box already holds the same source + sourceRefId, the
    // candidate is not added again (avoids duplicate counts/findings).
    //
    // Cache scope: `bypassCache=false` goes through `getOrSetDetail`, so a miss
    // here DOES warm the shared medicine-detail knowledge cache. "预检不落库"
    // refers only to the risk-check records and records caches, neither of which
    // this path touches — warming the detail cache is intended behaviour, not
    // leakage. (Confirmed 2026-09-24; no behaviour change.)
    let candidateIncluded = false;
    if (candidate != null) {
      const candidateSourceRefId = candidate.id.trim();
      const alreadyInBox = currentMedicines.some(
        (item) =>
          item.source === candidate.source &&
          (item.sourceRefId ?? '').trim() === candidateSourceRefId,
      );
      if (!alreadyInBox) {
        let detail: MedicineDetailDataLike;
        try {
          detail = await unwrapResult(
            this.medicinesService.getDetailWithCache(
              candidateSourceRefId,
              { source: candidate.source },
              false,
            ),
          );
        } catch (error) {
          if (error instanceof DomainFailureException) {
            throw error;
          }
          // 400 是给用户的答复，但它抹掉了"为什么拿不到候选资料"：没有这条日志时，
          // 上游知识库故障与"这个 id 确实不存在"在日志里长得一模一样。
          this.logger.warn(
            `Candidate medicine detail unavailable (source=${candidate.source}, id=${candidateSourceRefId}): ${
              error instanceof Error ? error.message : String(error)
            }`,
            error instanceof Error ? error.stack : undefined,
          );
          throw new DomainFailureException(
            createDomainFailure({
              kind: 'validation',
              code: 'VALIDATION_FAILED',
              detail: this.i18n.t('medicine.candidate_unavailable'),
              cause: error instanceof Error ? error : undefined,
            }),
          );
        }
        details.push({
          item: {
            id: candidate.id,
            source: candidate.source,
            sourceRefId: candidateSourceRefId,
            displayName: detail.name,
            startedAt: null,
          },
          detail,
        });
        candidateIncluded = true;
      }
    }

    // 3. Identify uncovered medicines (no detail fetched)
    const uncoveredItems = currentMedicines
      .filter((item) => !details.some((d) => d.item.id === item.id))
      .map((item) => ({
        id: item.id,
        source: item.source,
        sourceRefId: item.sourceRefId,
        displayName: item.displayName,
      }));

    // 4. Run risk detection
    const { findings, coverageIssues, redFlags, riskScore, riskLevel } =
      this.riskDetection.evaluateStaticRisk(
        details,
        activeAllergies,
        uncoveredItems,
      );

    return {
      overallRiskLevel: riskLevel,
      overallRiskScore: riskScore,
      currentMedicineCount:
        currentMedicines.length + (candidateIncluded ? 1 : 0),
      checkedMedicineCount: details.length,
      findings,
      coverageIssues,
      redFlags,
    };
  }

  // ── LLM context assembly ─────────────────────────────────────────────────
  //
  // Formerly `RiskContextBuilderService` (adapters/acl); assembly lives here
  // because every input is either application-internal state or a port fetch.

  private async buildLlmContext(
    userId: string,
    staticResult: MedicineRiskCheckResult,
  ): Promise<MedicineRiskLlmContext> {
    const [user, reminders] = await Promise.all([
      this.riskRecords.loadHealthContext(userId, LLM_CONTEXT_ROW_LIMIT),
      this.riskRecords.listReminders(userId),
    ]);

    const medicines: MedicineRiskLlmContext['medicines'] = [];
    if (user != null) {
      const eligibleItems = user.currentMedicines.flatMap((item) => {
        const source = item.source;
        const sourceRefId = item.sourceRefId?.trim();
        const knowledgeSource = asKnowledgeSource(source);
        if (
          knowledgeSource != null &&
          sourceRefId != null &&
          sourceRefId !== ''
        ) {
          return [{ item, source: knowledgeSource, sourceRefId }];
        }
        return [];
      });

      const llmDetailResults = await Promise.allSettled(
        eligibleItems.map(async ({ item, source, sourceRefId }) => {
          const detail = await unwrapResult(
            this.medicinesService.getDetailWithCache(
              sourceRefId,
              { source },
              false,
            ),
          );
          return { item, detail, source };
        }),
      );

      for (const result of llmDetailResults) {
        if (result.status === 'rejected') {
          this.logger.warn(
            `LLM context: failed to fetch detail: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          );
          continue;
        }
        const { item, detail, source } = result.value;
        const json = getDetailJson(detail);
        const drugInteractions = Array.isArray(json['drugInteractions'])
          ? (json['drugInteractions'] as Array<Record<string, unknown>>)
              .filter(
                (d) =>
                  typeof d['drugbankId'] === 'string' &&
                  typeof d['description'] === 'string',
              )
              .map((d) => ({
                target: String(d['drugbankId']),
                description: String(d['description']),
              }))
          : [];
        const ingredients = asNonEmptyString(json['ingredients']);
        const contraindications = asNonEmptyString(json['contraindications']);
        const precautions = asNonEmptyString(json['precautions']);
        const foodInteractions = Array.isArray(json['foodInteractions'])
          ? (json['foodInteractions'] as unknown[]).filter(
              (v): v is string => typeof v === 'string',
            )
          : null;
        const startedAt = item.startedAt
          ? formatDateOnly(item.startedAt)
          : null;
        medicines.push({
          name: item.displayName.trim() !== '' ? item.displayName : detail.name,
          source,
          ...(ingredients != null ? { ingredients } : {}),
          ...(contraindications != null ? { contraindications } : {}),
          ...(precautions != null ? { precautions } : {}),
          ...(foodInteractions != null ? { foodInteractions } : {}),
          ...(drugInteractions.length > 0 ? { drugInteractions } : {}),
          ...(startedAt != null ? { startedAt } : {}),
        });
      }
    }

    const allergies: MedicineRiskLlmContext['allergies'] =
      user?.allergies.map((a) => {
        const reaction = a.reaction;
        return {
          label: a.label,
          severity: a.severity ?? 'unknown',
          ...(reaction != null ? { reaction } : {}),
        };
      }) ?? [];

    const conditions: MedicineRiskLlmContext['conditions'] =
      user?.conditions.map((c) => ({
        label: c.label,
        status: c.status,
      })) ?? [];

    const reminderMedicines = user?.currentMedicines ?? [];
    const remindersCtx: MedicineRiskLlmContext['reminders'] = reminders
      .map((r) => {
        const medicine = reminderMedicines.find(
          (m) => m.id === r.currentMedicineId,
        );
        if (medicine == null) return null;
        const daysOfWeek = Array.isArray(r.daysOfWeek)
          ? (r.daysOfWeek as unknown[]).filter(
              (d): d is number => typeof d === 'number',
            )
          : undefined;
        const startDate = r.startDate ? formatDateOnly(r.startDate) : null;
        const endDate = r.endDate ? formatDateOnly(r.endDate) : null;
        return {
          medicineName: medicine.displayName,
          scheduledHour: r.scheduledHour,
          scheduledMinute: r.scheduledMinute,
          ...(daysOfWeek != null && daysOfWeek.length > 0
            ? { daysOfWeek }
            : {}),
          ...(startDate != null ? { startDate } : {}),
          ...(endDate != null ? { endDate } : {}),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null);

    const staticFindings = staticResult.findings.map((f) => ({
      type: f.type,
      severity: f.severity,
      description: [
        f.primaryMedicineName,
        f.secondaryMedicineName != null ? ` + ${f.secondaryMedicineName}` : '',
        f.relatedLabel != null ? ` (allergen: ${f.relatedLabel})` : '',
        f.evidence != null ? ` — ${f.evidence}` : '',
      ].join(''),
    }));

    return {
      medicines,
      allergies,
      conditions,
      reminders: remindersCtx,
      staticFindings,
    };
  }

  // ── LLM output mapping ──────────────────────────────────────────────────

  private mapLlmOutput(
    llmOutput: MedicineRiskLlmOutput,
    staticResult: MedicineRiskCheckResult,
  ): MedicineRiskCheckResult {
    const findings = llmOutput.findings.map((f) => ({
      type: f.type,
      severity: f.severity,
      context: 'none' as const,
      primaryMedicineName: f.primaryMedicineName,
      ...(f.secondaryMedicineName != null
        ? { secondaryMedicineName: f.secondaryMedicineName }
        : {}),
      evidence: f.description,
      recommendation: f.recommendation,
    }));

    return {
      overallRiskLevel: llmOutput.riskLevel,
      overallRiskScore: llmOutput.riskScore,
      currentMedicineCount: staticResult.currentMedicineCount,
      checkedMedicineCount: staticResult.checkedMedicineCount,
      findings,
      coverageIssues: staticResult.coverageIssues,
      redFlags: staticResult.redFlags,
      ...(llmOutput.overallRecommendation !== ''
        ? { overallRecommendation: llmOutput.overallRecommendation }
        : {}),
    } satisfies MedicineRiskCheckResult;
  }

  // ── DB persistence ──────────────────────────────────────────────────────

  private async persistRecord(
    userId: string,
    checkType: MedicineRiskCheckType,
    response: MedicineRiskCheckResult,
  ): Promise<MedicineRiskCheckRecord> {
    const record = await this.riskRecords.upsertRecord(userId, checkType, {
      result: toInputJsonValue(response),
      riskScore: response.overallRiskScore,
      riskLevel: response.overallRiskLevel,
    });

    // Invalidate cache — DB already has correct data
    await this.invalidateRecordsCache(userId);

    return this.toDto(record);
  }

  // ── Mapping ──────────────────────────────────────────────────────────────

  private toDto(record: MedicineRiskCheckRecordRow): MedicineRiskCheckRecord {
    return {
      checkType: record.checkType,
      result: record.result as MedicineRiskCheckResult,
      riskScore: record.riskScore,
      riskLevel: record.riskLevel as MedicineRiskLevel,
      stale: record.stale,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  // ── Error mapping ────────────────────────────────────────────────────────

  /**
   * Converts an unknown error thrown inside `doRun*` methods into a
   * `DomainFailure`. `DomainFailureException` instances are unwrapped to
   * preserve their original domain semantics; everything else falls back to
   * `INTERNAL_ERROR` so no raw exception leaks past the ResultAsync boundary.
   *
   * **Deliberately no `ServiceUnavailableException` branch.** The generator
   * signals a runtime model failure that way, and mapping it to
   * `DEPENDENCY_UNAVAILABLE` would answer 503 — but the client renders *any*
   * 503 on this endpoint as "AI analysis is not configured"
   * (`risk_check.dart` matches the code **or** `statusCode == 503`). A
   * retryable outage would then be presented as a permanent configuration gap,
   * which is the very confusion this change set removes. Runtime failures stay
   * `INTERNAL_ERROR` (500) so the client shows the real failure instead.
   */
  private toDomainFailure(error: unknown): DomainFailure {
    if (error instanceof LlmNotConfiguredException) {
      return createDomainFailure({
        kind: 'dependency',
        code: 'LLM_NOT_CONFIGURED',
        cause: error,
      });
    }
    return mapUnknownToInternalFailure(error);
  }

  // ── Cache keys ──────────────────────────────────────────────────────────

  private buildRecordsCacheKey(userId: string): string {
    return `${RISK_CHECK_CACHE_KEY_PREFIX}:records:${userId}`;
  }

  /**
   * Invalidates the records cache for a user. Retries once on failure; if
   * the retry also fails, logs at `error` level so operators can detect
   * DB/cache divergence (stale data will still expire via TTL as a
   * last-resort safety net).
   */
  private async invalidateRecordsCache(userId: string): Promise<void> {
    const cacheKey = this.buildRecordsCacheKey(userId);
    try {
      await this.cache.del(cacheKey);
    } catch (firstError) {
      // Retry once — transient Redis blips are common
      try {
        await this.cache.del(cacheKey);
      } catch (retryError) {
        this.logger.error(
          `Failed to invalidate risk-check cache for user ${userId} after retry; ` +
            `DB has correct data but cached reads may return stale results until TTL expiry`,
          retryError instanceof Error ? retryError.stack : undefined,
          {
            userId,
            cacheKey,
            firstError:
              firstError instanceof Error
                ? firstError.message
                : String(firstError),
          },
        );
      }
    }
  }
}
