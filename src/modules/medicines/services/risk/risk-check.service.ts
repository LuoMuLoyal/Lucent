import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../../../prisma';
import { MedicinesService } from '../medicines.service';
import { MedicineRiskLlmGeneratorService } from './risk-llm-generator.service';
import { RiskDetectionService } from './risk-detection.service';
import { RiskContextBuilderService } from './risk-context-builder.service';
import { ResultCode, nonDeleted, toInputJsonValue } from '../../../../common';
import type {
  MedicineRiskCheckResponseDto,
  MedicineRiskCheckRecordDto,
  MedicineRiskLevel,
} from '../../dto/risk/risk-check-response.dto';
import type { MedicineRiskLlmOutput } from '../../schemas/risk-check.schema';
import type { MedicineDetailWrapper } from '../../utils/ingredient-canonicalization';
import type { AllergyRecord } from '../../utils/allergy-severity';

const RISK_CHECK_CACHE_KEY_PREFIX = 'medicines:risk-check';
const RISK_CHECK_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Maximum number of related records (allergies, conditions, current
 * medicines) fetched per user during a risk check. Prevents extreme data
 * volumes from causing unbounded query latency.
 */
const RISK_CHECK_MAX_RELATED_RECORDS = 100;

@Injectable()
export class MedicineRiskCheckService {
  private readonly logger = new Logger(MedicineRiskCheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly medicinesService: MedicinesService,
    private readonly llmGenerator: MedicineRiskLlmGeneratorService,
    private readonly riskDetection: RiskDetectionService,
    private readonly riskContextBuilder: RiskContextBuilderService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────

  async getRecords(userId: string): Promise<{
    static: MedicineRiskCheckRecordDto | null;
    llm: MedicineRiskCheckRecordDto | null;
  }> {
    const cacheKey = this.buildRecordsCacheKey(userId);
    const cached = await this.cache.get<{
      static: MedicineRiskCheckRecordDto | null;
      llm: MedicineRiskCheckRecordDto | null;
    }>(cacheKey);
    if (cached != null) {
      return cached;
    }

    const records = await this.prisma.medicineRiskCheckRecord.findMany({
      where: { userId },
    });

    const result = {
      static: records.find((r) => r.checkType === 'static') ?? null,
      llm: records.find((r) => r.checkType === 'llm') ?? null,
    };

    const mapped = {
      static: result.static != null ? this.toDto(result.static) : null,
      llm: result.llm != null ? this.toDto(result.llm) : null,
    };

    await this.cache.set(cacheKey, mapped, RISK_CHECK_CACHE_TTL_MS);
    return mapped;
  }

  async runStaticCheck(userId: string): Promise<MedicineRiskCheckRecordDto> {
    const response = await this.evaluateStaticCheck(userId);
    return this.persistRecord(userId, 'static', response);
  }

  async runLlmCheck(userId: string): Promise<MedicineRiskCheckRecordDto> {
    if (!this.llmGenerator.hasAnalysisModel()) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: 'LLM analysis model is not configured',
      });
    }

    // 1. Run static check to get baseline findings
    const staticResult = await this.evaluateStaticCheck(userId);

    // 2. Build LLM context
    const llmContext = await this.riskContextBuilder.buildLlmContext(
      userId,
      staticResult,
    );

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
    await this.prisma.medicineRiskCheckRecord.updateMany({
      where: { userId },
      data: { stale: true },
    });
    // Delete Redis cache for records — next GET will re-read from DB
    await this.invalidateRecordsCache(userId);
  }

  // ── Static check logic ──────────────────────────────────────────────────

  private async evaluateStaticCheck(
    userId: string,
  ): Promise<MedicineRiskCheckResponseDto> {
    // 1. Get health context directly from DB
    const user = await this.prisma.user.findFirst({
      where: { id: userId, ...nonDeleted },
      include: {
        allergies: {
          where: { isActive: true },
          orderBy: { updatedAt: 'desc' },
          take: RISK_CHECK_MAX_RELATED_RECORDS,
        },
        conditions: {
          where: { status: 'active' },
          orderBy: { updatedAt: 'desc' },
          take: RISK_CHECK_MAX_RELATED_RECORDS,
        },
        currentMedicines: {
          where: { isCurrent: true },
          orderBy: { updatedAt: 'desc' },
          take: RISK_CHECK_MAX_RELATED_RECORDS,
        },
      },
    });

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
        const detail = await this.medicinesService.getDetailWithCache(
          sourceRefId,
          { source },
          false,
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
      currentMedicineCount: currentMedicines.length,
      checkedMedicineCount: details.length,
      findings,
      coverageIssues,
      redFlags,
    };
  }

  // ── LLM output mapping ──────────────────────────────────────────────────

  private mapLlmOutput(
    llmOutput: MedicineRiskLlmOutput,
    staticResult: MedicineRiskCheckResponseDto,
  ): MedicineRiskCheckResponseDto {
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
    };
  }

  // ── DB persistence ──────────────────────────────────────────────────────

  private async persistRecord(
    userId: string,
    checkType: 'static' | 'llm',
    response: MedicineRiskCheckResponseDto,
  ): Promise<MedicineRiskCheckRecordDto> {
    const record = await this.prisma.medicineRiskCheckRecord.upsert({
      where: { userId_checkType: { userId, checkType } },
      create: {
        userId,
        checkType,
        result: toInputJsonValue(response),
        riskScore: response.overallRiskScore,
        riskLevel: response.overallRiskLevel,
        stale: false,
      },
      update: {
        result: toInputJsonValue(response),
        riskScore: response.overallRiskScore,
        riskLevel: response.overallRiskLevel,
        stale: false,
      },
    });

    // Invalidate cache — DB already has correct data
    await this.invalidateRecordsCache(userId);

    return this.toDto(record);
  }

  // ── Mapping ──────────────────────────────────────────────────────────────

  private toDto(record: {
    checkType: string;
    result: unknown;
    riskScore: number;
    riskLevel: string;
    stale: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): MedicineRiskCheckRecordDto {
    return {
      checkType: record.checkType as 'static' | 'llm',
      result: record.result as MedicineRiskCheckResponseDto,
      riskScore: record.riskScore,
      riskLevel: record.riskLevel as MedicineRiskLevel,
      stale: record.stale,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
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
