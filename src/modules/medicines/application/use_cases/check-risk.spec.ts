import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { MedicineRiskCheckService } from './check-risk.js';
import type { MedicinesService } from './medicines.js';
import type {
  MedicineRiskCheckRecordRow,
  MedicineReminderRow,
  MedicineRiskRecordsPort,
  UserHealthContext,
} from '../ports/risk-records.js';
import type {
  MedicineRiskLlmContext,
  MedicineRiskLlmPort,
} from '../ports/risk-llm.js';
import type { GraphReader } from '../../domain/relations/relations.js';
import type { RiskDetectionService } from '../../domain/services/risk-scoring.js';
import type { I18nService } from 'nestjs-i18n';
import {
  okAsync,
  errAsync,
  createDomainFailure,
  DomainFailureException,
  type ResultAsync,
  type DomainFailure,
} from '../../../../common/result/index.js';

/**
 * Builds the service with every collaborator mocked at its port boundary —
 * the use case owns no Prisma handle any more (ADR-0024), so the persistence
 * port is the only DB-shaped seam the tests need to speak to.
 */
function build() {
  const riskRecords = {
    listRecords: vi.fn(),
    upsertRecord: vi.fn(),
    markAllStale: vi.fn(),
    loadHealthContext: vi.fn(),
    listReminders: vi.fn(),
  } as unknown as MedicineRiskRecordsPort;
  const medicinesService = {
    getDetailWithCache: vi.fn(),
  } as unknown as MedicinesService;
  const llmGenerator = {
    hasAnalysisModel: vi.fn(() => true),
    generate: vi.fn(),
  } as unknown as MedicineRiskLlmPort;
  const riskDetection = {
    evaluateStaticRisk: vi.fn().mockReturnValue({
      findings: [],
      coverageIssues: [],
      redFlags: [],
      riskScore: 0,
      riskLevel: 'safe',
    }),
  } as unknown as RiskDetectionService;
  const cache = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  } as unknown as Cache;
  const i18n = {
    t: vi.fn((key: string) => key),
  } as unknown as I18nService;
  // 图默认不可用：本文件测风险检查本身；机制补充的边界在 risk-mechanism.spec.ts。
  const graphReader = {
    isConfigured: vi.fn(() => false),
    mechanismPaths: vi
      .fn()
      .mockResolvedValue({ ok: false, reason: 'notConfigured' }),
  } as unknown as GraphReader;
  const svc = new MedicineRiskCheckService(
    riskRecords,
    medicinesService,
    llmGenerator,
    riskDetection,
    graphReader,
    cache,
    i18n,
  );
  return {
    riskRecords,
    medicinesService,
    llmGenerator,
    riskDetection,
    cache,
    i18n,
    svc,
  };
}

const recordRow: MedicineRiskCheckRecordRow = {
  checkType: 'static',
  result: { overallRiskLevel: 'safe', overallRiskScore: 0 },
  riskScore: 0,
  riskLevel: 'safe',
  stale: false,
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
  updatedAt: new Date('2026-06-01T00:00:00.000Z'),
};

/** A health snapshot with no related rows — the common "empty profile" case. */
const emptyHealthContext: UserHealthContext = {
  allergies: [],
  conditions: [],
  currentMedicines: [],
};

/**
 * Unwraps a ResultAsync into a thrown DomainFailureException on error,
 * matching the controller-layer unwrapResult behaviour so tests can use
 * `await expect(...).rejects.toThrow(DomainFailureException)`.
 */
async function unwrap<T>(
  resultAsync: ResultAsync<T, DomainFailure>,
): Promise<T> {
  return resultAsync.match(
    (v) => v as T,
    (f) => {
      throw new DomainFailureException(f);
    },
  );
}

describe('MedicineRiskCheckService', () => {
  // ── getRecords ──────────────────────────────────────────────────────────

  it('getRecords returns cached value without touching the records port', async () => {
    const { riskRecords, cache, svc } = build();
    const cached = { static: null, llm: null };
    vi.mocked(cache.get).mockResolvedValue(cached as never);

    const result = await svc.getRecords('u1');

    expect(result).toEqual(cached);
    expect(riskRecords.listRecords).not.toHaveBeenCalled();
  });

  it('getRecords reads, maps and caches records from the port', async () => {
    const { riskRecords, cache, svc } = build();
    vi.mocked(cache.get).mockResolvedValue(undefined);
    vi.mocked(riskRecords.listRecords).mockResolvedValue([
      { ...recordRow, checkType: 'static' },
      { ...recordRow, checkType: 'llm' },
    ]);

    const result = await svc.getRecords('u1');

    expect(result.static?.checkType).toBe('static');
    expect(result.llm?.checkType).toBe('llm');
    expect(cache.set).toHaveBeenCalledWith(
      expect.stringContaining('medicines:risk-check'),
      expect.any(Object),
      expect.any(Number),
    );
  });

  it('getRecords maps null records for a user with no history', async () => {
    const { riskRecords, cache, svc } = build();
    vi.mocked(cache.get).mockResolvedValue(undefined);
    vi.mocked(riskRecords.listRecords).mockResolvedValue([]);

    const result = await svc.getRecords('u1');

    expect(result).toEqual({ static: null, llm: null });
    expect(cache.set).toHaveBeenCalled();
  });

  // ── Static check ────────────────────────────────────────────────────────

  it('runStaticCheck returns a safe empty response when the user is missing', async () => {
    const { riskRecords, svc } = build();
    vi.mocked(riskRecords.loadHealthContext).mockResolvedValue(null);
    vi.mocked(riskRecords.upsertRecord).mockResolvedValue(recordRow);

    const result = await unwrap(svc.runStaticCheck('u1'));

    expect(result.checkType).toBe('static');
    expect(riskRecords.upsertRecord).toHaveBeenCalled();
  });

  it('runStaticCheck evaluates risk for an existing user with eligible medicines', async () => {
    const { riskRecords, medicinesService, riskDetection, svc } = build();
    vi.mocked(riskRecords.loadHealthContext).mockResolvedValue({
      allergies: [
        { label: '青霉素', reaction: 'rash', severity: 'high', isActive: true },
      ],
      conditions: [],
      currentMedicines: [
        {
          id: 'm1',
          source: 'cn',
          sourceRefId: 'cn-1',
          displayName: '对乙酰氨基酚',
          startedAt: new Date('2026-06-01T00:00:00.000Z'),
          healthEventIds: [],
        },
        {
          id: 'm2',
          source: 'custom',
          sourceRefId: 'local-1',
          displayName: '自制药',
          startedAt: new Date('2026-06-01T00:00:00.000Z'),
          healthEventIds: [],
        },
        {
          id: 'm3',
          source: 'cn',
          sourceRefId: '',
          displayName: '无引用药',
          startedAt: new Date('2026-06-01T00:00:00.000Z'),
          healthEventIds: [],
        },
      ],
    });
    vi.mocked(medicinesService.getDetailWithCache).mockReturnValue(
      okAsync({
        id: 'detail-cn-1',
        name: '对乙酰氨基酚',
        ingredients: [],
      } as never),
    );
    vi.mocked(riskRecords.upsertRecord).mockResolvedValue(recordRow);

    const result = await unwrap(svc.runStaticCheck('u1'));

    // m1 走 detail 获取;m2/m3 无合法 sourceRefId,落入 uncovered
    expect(medicinesService.getDetailWithCache).toHaveBeenCalledTimes(1);
    expect(riskDetection.evaluateStaticRisk).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          item: expect.objectContaining({ id: 'm1' }),
        }),
      ]),
      [
        {
          label: '青霉素',
          reaction: 'rash',
          severity: 'high',
          isActive: true,
        },
      ],
      expect.arrayContaining([
        expect.objectContaining({ id: 'm2' }),
        expect.objectContaining({ id: 'm3' }),
      ]),
    );
    expect(result.checkType).toBe('static');
  });

  it('evaluateStaticCheck skips failed detail fetches and reports them as uncovered', async () => {
    const { riskRecords, medicinesService, riskDetection, svc } = build();
    vi.mocked(riskRecords.loadHealthContext).mockResolvedValue({
      allergies: [],
      conditions: [],
      currentMedicines: [
        {
          id: 'm1',
          source: 'drugbank',
          sourceRefId: 'db-1',
          displayName: 'DrugA',
          startedAt: new Date('2026-06-01T00:00:00.000Z'),
          healthEventIds: [],
        },
      ],
    });
    vi.mocked(medicinesService.getDetailWithCache).mockReturnValue(
      errAsync(
        createDomainFailure({
          kind: 'internal',
          code: 'INTERNAL_ERROR',
          detail: 'db down',
        }),
      ),
    );
    vi.mocked(riskRecords.upsertRecord).mockResolvedValue(recordRow);

    await unwrap(svc.runStaticCheck('u1'));

    expect(riskDetection.evaluateStaticRisk).toHaveBeenCalledWith(
      [],
      [],
      expect.arrayContaining([expect.objectContaining({ id: 'm1' })]),
    );
  });

  it('runStaticCheck tolerates cache invalidation failure during persist (retries then logs error)', async () => {
    const { riskRecords, cache, svc } = build();
    vi.mocked(riskRecords.loadHealthContext).mockResolvedValue(null);
    vi.mocked(riskRecords.upsertRecord).mockResolvedValue(recordRow);
    vi.mocked(cache.del).mockRejectedValue(new Error('redis down'));
    const errorSpy = vi
      .spyOn(svc['logger'], 'error')
      .mockImplementation(() => undefined);

    await expect(unwrap(svc.runStaticCheck('u1'))).resolves.toMatchObject({
      checkType: 'static',
    });

    // Should have retried
    expect(cache.del).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalled();
  });

  // ── Candidate pre-check ─────────────────────────────────────────────────

  it('runStaticCheck with a candidate includes it in the evaluation without persisting', async () => {
    const { riskRecords, medicinesService, riskDetection, cache, svc } =
      build();
    vi.mocked(riskRecords.loadHealthContext).mockResolvedValue({
      allergies: [],
      conditions: [],
      currentMedicines: [
        {
          id: 'm1',
          source: 'cn',
          sourceRefId: 'cn-1',
          displayName: '对乙酰氨基酚',
          startedAt: new Date('2026-06-01T00:00:00.000Z'),
          healthEventIds: [],
        },
      ],
    });
    vi.mocked(medicinesService.getDetailWithCache).mockImplementation(
      (id: string) =>
        okAsync(
          (id === 'cn-1'
            ? { id: 'cn-1', name: '对乙酰氨基酚', source: 'cn' }
            : { id, name: `候选药品-${id}`, source: 'cn' }) as never,
        ),
    );
    vi.mocked(riskDetection.evaluateStaticRisk).mockReturnValue({
      findings: [
        {
          type: 'duplicateIngredient',
          severity: 'medium',
          context: 'none',
          primaryMedicineName: '候选药品-cn-2',
          secondaryMedicineName: '对乙酰氨基酚',
          evidence: 'acetaminophen',
        },
      ],
      coverageIssues: [],
      redFlags: [],
      riskScore: 15,
      riskLevel: 'caution',
    });

    const result = await unwrap(
      svc.runStaticCheck('u1', {
        source: 'cn',
        id: 'cn-2',
      }),
    );

    expect(medicinesService.getDetailWithCache).toHaveBeenCalledWith(
      'cn-2',
      { source: 'cn' },
      false,
    );
    expect(riskDetection.evaluateStaticRisk).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          item: expect.objectContaining({
            id: 'cn-2',
            source: 'cn',
            sourceRefId: 'cn-2',
          }),
        }),
      ]),
      [],
      [],
    );
    // 候选作为 details 一员参与检测：计数 +1
    expect(result.result.currentMedicineCount).toBe(2);
    expect(result.result.checkedMedicineCount).toBe(2);
    expect(result.result.findings[0]?.primaryMedicineName).toBe(
      '候选药品-cn-2',
    );
    // 候选预检不落库、不动缓存
    expect(riskRecords.upsertRecord).not.toHaveBeenCalled();
    expect(cache.del).not.toHaveBeenCalled();
    // 返回 record 形 DTO 即时快照
    expect(result).toMatchObject({
      checkType: 'static',
      stale: false,
      riskScore: 15,
      riskLevel: 'caution',
    });
    expect(result.createdAt).toEqual(result.updatedAt);
  });

  it('runStaticCheck does not re-add a candidate already in the box', async () => {
    const { riskRecords, medicinesService, riskDetection, svc } = build();
    vi.mocked(riskRecords.loadHealthContext).mockResolvedValue({
      allergies: [],
      conditions: [],
      currentMedicines: [
        {
          id: 'm1',
          source: 'cn',
          sourceRefId: ' cn-1 ',
          displayName: '对乙酰氨基酚',
          startedAt: new Date('2026-06-01T00:00:00.000Z'),
          healthEventIds: [],
        },
      ],
    });
    vi.mocked(medicinesService.getDetailWithCache).mockReturnValue(
      okAsync({
        id: 'cn-1',
        name: '对乙酰氨基酚',
        source: 'cn',
      } as never),
    );

    const result = await unwrap(
      svc.runStaticCheck('u1', {
        source: 'cn',
        id: 'cn-1',
      }),
    );

    // 药箱已有同 source + sourceRefId（trim 后比较），候选不再单独加入
    expect(medicinesService.getDetailWithCache).toHaveBeenCalledTimes(1);
    const [detailsArg] = vi.mocked(riskDetection.evaluateStaticRisk).mock
      .calls[0]!;
    expect(detailsArg).toHaveLength(1);
    expect(result.result.currentMedicineCount).toBe(1);
    expect(result.result.checkedMedicineCount).toBe(1);
  });

  it('runStaticCheck propagates DomainFailureException when the candidate detail is missing', async () => {
    const { riskRecords, medicinesService, svc } = build();
    vi.mocked(riskRecords.loadHealthContext).mockResolvedValue(
      emptyHealthContext,
    );
    vi.mocked(medicinesService.getDetailWithCache).mockReturnValue(
      errAsync(
        createDomainFailure({
          kind: 'not_found',
          code: 'RESOURCE_NOT_FOUND',
          detail: 'medicine not found',
        }),
      ),
    );

    await expect(
      unwrap(svc.runStaticCheck('u1', { source: 'cn', id: 'missing' })),
    ).rejects.toThrow(DomainFailureException);

    expect(riskRecords.upsertRecord).not.toHaveBeenCalled();
  });

  it('runStaticCheck wraps non-NotFound candidate resolution failures as DomainFailureException', async () => {
    const { riskRecords, medicinesService, svc } = build();
    vi.mocked(riskRecords.loadHealthContext).mockResolvedValue(
      emptyHealthContext,
    );
    vi.mocked(medicinesService.getDetailWithCache).mockReturnValue(
      errAsync(
        createDomainFailure({
          kind: 'internal',
          code: 'INTERNAL_ERROR',
          detail: 'upstream timeout',
        }),
      ),
    );

    await expect(
      unwrap(svc.runStaticCheck('u1', { source: 'drugbank', id: 'DB00001' })),
    ).rejects.toThrow(DomainFailureException);

    expect(riskRecords.upsertRecord).not.toHaveBeenCalled();
  });

  // ── LLM check ───────────────────────────────────────────────────────────

  it('runLlmCheck throws DomainFailureException when the LLM analysis model is not configured', async () => {
    const { llmGenerator, svc } = build();
    vi.mocked(llmGenerator.hasAnalysisModel).mockReturnValue(false);

    await expect(unwrap(svc.runLlmCheck('u1'))).rejects.toThrow(
      DomainFailureException,
    );
  });

  it('reports LLM_NOT_CONFIGURED (not a retryable outage) when no model exists', async () => {
    const { llmGenerator, svc } = build();
    vi.mocked(llmGenerator.hasAnalysisModel).mockReturnValue(false);

    const failure = await unwrap(svc.runLlmCheck('u1')).then(
      () => null,
      (error: unknown) => (error as DomainFailureException).failure,
    );

    expect(failure?.code).toBe('LLM_NOT_CONFIGURED');
    expect(failure?.retryable).not.toBe(true);
    // The registered bilingual detail must not be overridden by a raw sentence.
    expect(failure?.detail).toBeUndefined();
  });

  it('keeps a runtime LLM outage off 503 so the client does not call it unconfigured', async () => {
    // The client renders *any* 503 on this endpoint as "AI analysis is not
    // configured" (`risk_check.dart` matches the code or a 503 status), so a
    // retryable outage must not be mapped to DEPENDENCY_UNAVAILABLE — that
    // would present a transient failure as a permanent configuration gap.
    const { riskRecords, llmGenerator, svc } = build();
    vi.mocked(riskRecords.loadHealthContext).mockResolvedValue(
      emptyHealthContext,
    );
    vi.mocked(riskRecords.listReminders).mockResolvedValue([]);
    vi.mocked(llmGenerator.generate).mockRejectedValue(
      new ServiceUnavailableException('LLM generate failed: upstream 503'),
    );

    const failure = await unwrap(svc.runLlmCheck('u1')).then(
      () => null,
      (error: unknown) => (error as DomainFailureException).failure,
    );

    expect(failure?.code).toBe('INTERNAL_ERROR');
  });

  it('runLlmCheck builds context from the records port, generates output and persists', async () => {
    const { riskRecords, llmGenerator, cache, svc } = build();
    vi.mocked(riskRecords.loadHealthContext).mockResolvedValue(
      emptyHealthContext,
    );
    vi.mocked(riskRecords.listReminders).mockResolvedValue([]);
    const llmRecord: MedicineRiskCheckRecordRow = {
      ...recordRow,
      checkType: 'llm',
      result: {
        overallRiskLevel: 'caution',
        overallRiskScore: 10,
        currentMedicineCount: 0,
        checkedMedicineCount: 0,
        findings: [
          {
            type: 'interaction',
            severity: 'medium',
            context: 'none',
            primaryMedicineName: 'DrugA',
            secondaryMedicineName: 'DrugB',
            evidence: 'desc',
            recommendation: 'rec',
          },
        ],
        coverageIssues: [],
        redFlags: [],
        overallRecommendation: 'consult doctor',
      },
    };
    vi.mocked(riskRecords.upsertRecord).mockResolvedValue(llmRecord);
    vi.mocked(llmGenerator.generate).mockResolvedValue({
      summary: 'summary',
      riskScore: 10,
      riskLevel: 'caution',
      findings: [
        {
          type: 'interaction',
          severity: 'medium',
          title: 't',
          description: 'desc',
          recommendation: 'rec',
          primaryMedicineName: 'DrugA',
          secondaryMedicineName: 'DrugB',
        },
      ],
      overallRecommendation: 'consult doctor',
    });

    const result = await unwrap(svc.runLlmCheck('u1'));

    expect(result.checkType).toBe('llm');
    // The context is assembled inside the use case now (the old
    // `RiskContextBuilderService` ACL is gone), so the assertion moves to the
    // generator hand-off: the health snapshot is fetched through the port and
    // the assembled context reaches the LLM.
    expect(riskRecords.loadHealthContext).toHaveBeenCalled();
    expect(llmGenerator.generate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(llmGenerator.generate).mock.calls[0]?.[0]).toMatchObject({
      medicines: [],
      allergies: [],
      conditions: [],
      reminders: [],
    } satisfies Partial<MedicineRiskLlmContext>);
    expect(result.result.findings[0]?.secondaryMedicineName).toBe('DrugB');
    expect(result.result.overallRecommendation).toBe('consult doctor');
    expect(cache.del).toHaveBeenCalled();
  });

  it('runLlmCheck maps llm findings without secondary medicine', async () => {
    const { riskRecords, llmGenerator, svc } = build();
    vi.mocked(riskRecords.loadHealthContext).mockResolvedValue(
      emptyHealthContext,
    );
    vi.mocked(riskRecords.listReminders).mockResolvedValue([]);
    const llmRecord: MedicineRiskCheckRecordRow = {
      ...recordRow,
      checkType: 'llm',
      result: {
        overallRiskLevel: 'risk',
        overallRiskScore: 20,
        currentMedicineCount: 0,
        checkedMedicineCount: 0,
        findings: [
          {
            type: 'allergy',
            severity: 'high',
            context: 'none',
            primaryMedicineName: 'DrugA',
            evidence: 'desc',
            recommendation: 'rec',
          },
        ],
        coverageIssues: [],
        redFlags: [],
      },
    };
    vi.mocked(riskRecords.upsertRecord).mockResolvedValue(llmRecord);
    vi.mocked(llmGenerator.generate).mockResolvedValue({
      summary: 'summary',
      riskScore: 20,
      riskLevel: 'risk',
      findings: [
        {
          type: 'allergy',
          severity: 'high',
          title: 't',
          description: 'desc',
          recommendation: 'rec',
          primaryMedicineName: 'DrugA',
        },
      ],
      overallRecommendation: '',
    });

    const result = await unwrap(svc.runLlmCheck('u1'));

    expect(result.result.findings[0]).not.toHaveProperty(
      'secondaryMedicineName',
    );
    expect(result.result).not.toHaveProperty('overallRecommendation');
  });

  it('runLlmCheck joins reminders to box medicines and formats dates for the LLM context', async () => {
    const { riskRecords, medicinesService, llmGenerator, svc } = build();
    vi.mocked(riskRecords.loadHealthContext).mockResolvedValue({
      allergies: [
        { label: '青霉素', reaction: null, severity: null, isActive: true },
      ],
      conditions: [{ label: '高血压', status: 'active' }],
      currentMedicines: [
        {
          id: 'm1',
          source: 'cn',
          sourceRefId: 'cn-1',
          displayName: '对乙酰氨基酚',
          startedAt: new Date('2026-06-01T00:00:00.000Z'),
          healthEventIds: [],
        },
      ],
    });
    vi.mocked(medicinesService.getDetailWithCache).mockReturnValue(
      okAsync({
        id: 'cn-1',
        source: 'cn',
        name: '对乙酰氨基酚',
        subtitle: null,
        detail: {
          ingredients: '对乙酰氨基酚',
          contraindications: '严重肝肾功能不全',
          precautions: '不宜长期服用',
          foodInteractions: ['酒精'],
          drugInteractions: [
            { drugbankId: 'DB00001', description: 'CYP 抑制' },
          ],
        },
      }),
    );
    const reminders: MedicineReminderRow[] = [
      {
        currentMedicineId: 'm1',
        scheduledHour: 8,
        scheduledMinute: 30,
        daysOfWeek: [1, 3, 5],
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        endDate: null,
      },
      {
        // Not attached to a box medicine → dropped from the context.
        currentMedicineId: 'm-missing',
        scheduledHour: 20,
        scheduledMinute: 0,
        daysOfWeek: null,
        startDate: null,
        endDate: null,
      },
    ];
    vi.mocked(riskRecords.listReminders).mockResolvedValue(reminders);
    vi.mocked(riskRecords.upsertRecord).mockResolvedValue({
      ...recordRow,
      checkType: 'llm',
    });
    vi.mocked(llmGenerator.generate).mockResolvedValue({
      summary: 'summary',
      riskScore: 0,
      riskLevel: 'safe',
      findings: [],
      overallRecommendation: '',
    });

    await unwrap(svc.runLlmCheck('u1'));

    const context = vi.mocked(llmGenerator.generate).mock
      .calls[0]?.[0] as MedicineRiskLlmContext;
    // Severity falls back to `unknown` when the allergy row has none.
    expect(context.allergies).toEqual([
      { label: '青霉素', severity: 'unknown' },
    ]);
    expect(context.conditions).toEqual([{ label: '高血压', status: 'active' }]);
    expect(context.reminders).toEqual([
      {
        medicineName: '对乙酰氨基酚',
        scheduledHour: 8,
        scheduledMinute: 30,
        daysOfWeek: [1, 3, 5],
        startDate: '2026-06-01',
      },
    ]);
    expect(context.medicines[0]).toMatchObject({
      name: '对乙酰氨基酚',
      source: 'cn',
      startedAt: '2026-06-01',
    });
  });

  // ── markStale ───────────────────────────────────────────────────────────

  it('markStale retries cache invalidation on first failure and succeeds on retry', async () => {
    const { riskRecords, cache, svc } = build();
    vi.mocked(cache.del)
      .mockRejectedValueOnce(new Error('redis timeout'))
      .mockResolvedValueOnce(true);
    vi.mocked(riskRecords.markAllStale).mockResolvedValue(undefined);

    await svc.markStale('u1');

    expect(cache.del).toHaveBeenCalledTimes(2);
  });

  it('markStale updates records and logs error when cache.del fails after retry', async () => {
    const { riskRecords, cache, svc } = build();
    vi.mocked(cache.del).mockRejectedValue(new Error('redis down'));
    vi.mocked(riskRecords.markAllStale).mockResolvedValue(undefined);
    const errorSpy = vi
      .spyOn(svc['logger'], 'error')
      .mockImplementation(() => undefined);

    await expect(svc.markStale('u1')).resolves.toBeUndefined();

    expect(riskRecords.markAllStale).toHaveBeenCalledWith('u1');
    expect(cache.del).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalled();
  });
});
