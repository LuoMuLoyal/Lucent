import { describe, expect, it, vi } from 'vitest';
import type { Cache } from 'cache-manager';
import { MedicineRiskCheckService } from './risk-check.service';
import type { PrismaService } from '../../../../prisma';
import type { MedicinesService } from '../medicines.service';
import type { MedicineRiskLlmGeneratorService } from './risk-llm-generator.service';
import type { RiskDetectionService } from './risk-detection.service';
import type { RiskContextBuilderService } from './risk-context-builder.service';

function build() {
  const prisma = {
    medicineRiskCheckRecord: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findFirst: vi.fn() },
  } as unknown as PrismaService;
  const medicinesService = {
    getDetailWithCache: vi.fn(),
  } as unknown as MedicinesService;
  const llmGenerator = {
    hasAnalysisModel: vi.fn(() => true),
    generate: vi.fn(),
  } as unknown as MedicineRiskLlmGeneratorService;
  const riskDetection = {
    evaluateStaticRisk: vi.fn().mockReturnValue({
      findings: [],
      coverageIssues: [],
      redFlags: [],
      riskScore: 0,
      riskLevel: 'safe',
    }),
  } as unknown as RiskDetectionService;
  const riskContextBuilder = {
    buildLlmContext: vi.fn(),
  } as unknown as RiskContextBuilderService;
  const cache = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  } as unknown as Cache;
  const svc = new MedicineRiskCheckService(
    prisma,
    medicinesService,
    llmGenerator,
    riskDetection,
    riskContextBuilder,
    cache,
  );
  return {
    prisma,
    medicinesService,
    llmGenerator,
    riskDetection,
    riskContextBuilder,
    cache,
    svc,
  };
}

const recordRow = {
  checkType: 'static',
  result: { overallRiskLevel: 'safe', overallRiskScore: 0 },
  riskScore: 0,
  riskLevel: 'safe',
  stale: false,
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
  updatedAt: new Date('2026-06-01T00:00:00.000Z'),
};

describe('MedicineRiskCheckService', () => {
  it('getRecords returns cached value without touching the DB', async () => {
    const { prisma, cache, svc } = build();
    const cached = { static: null, llm: null };
    vi.mocked(cache.get).mockResolvedValue(cached as never);

    const result = await svc.getRecords('u1');

    expect(result).toEqual(cached);
    expect(prisma.medicineRiskCheckRecord.findMany).not.toHaveBeenCalled();
  });

  it('getRecords reads, maps and caches records from the DB', async () => {
    const { prisma, cache, svc } = build();
    vi.mocked(cache.get).mockResolvedValue(undefined);
    vi.mocked(prisma.medicineRiskCheckRecord.findMany).mockResolvedValue([
      { ...recordRow, checkType: 'static' },
      { ...recordRow, checkType: 'llm' },
    ] as never);

    const result = await svc.getRecords('u1');

    expect(result.static?.checkType).toBe('static');
    expect(result.llm?.checkType).toBe('llm');
    expect(cache.set).toHaveBeenCalledWith(
      expect.stringContaining('medicines:risk-check'),
      expect.any(Object),
      expect.any(Number),
    );
  });

  it('runStaticCheck returns a safe empty response when the user is missing', async () => {
    const { prisma, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.medicineRiskCheckRecord.upsert).mockResolvedValue(
      recordRow as never,
    );

    const result = await svc.runStaticCheck('u1');

    expect(result.checkType).toBe('static');
    expect(prisma.medicineRiskCheckRecord.upsert).toHaveBeenCalled();
  });

  it('runLlmCheck throws when the LLM analysis model is not configured', async () => {
    const { llmGenerator, svc } = build();
    vi.mocked(llmGenerator.hasAnalysisModel).mockReturnValue(false);

    await expect(svc.runLlmCheck('u1')).rejects.toThrow(
      'LLM analysis model is not configured',
    );
  });

  it('runLlmCheck builds context, generates output and persists', async () => {
    const { prisma, llmGenerator, riskContextBuilder, cache, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    const llmRecord = {
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
    vi.mocked(prisma.medicineRiskCheckRecord.upsert).mockResolvedValue(
      llmRecord as never,
    );
    vi.mocked(riskContextBuilder.buildLlmContext).mockResolvedValue(
      {} as never,
    );
    vi.mocked(llmGenerator.generate).mockResolvedValue({
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
    } as never);

    const result = await svc.runLlmCheck('u1');

    expect(result.checkType).toBe('llm');
    expect(riskContextBuilder.buildLlmContext).toHaveBeenCalledWith(
      'u1',
      expect.anything(),
    );
    expect(llmGenerator.generate).toHaveBeenCalledTimes(1);
    expect(result.result.findings[0]?.secondaryMedicineName).toBe('DrugB');
    expect(result.result.overallRecommendation).toBe('consult doctor');
    expect(cache.del).toHaveBeenCalled();
  });

  it('getRecords maps null records for a user with no history', async () => {
    const { prisma, cache, svc } = build();
    vi.mocked(cache.get).mockResolvedValue(undefined);
    vi.mocked(prisma.medicineRiskCheckRecord.findMany).mockResolvedValue([]);

    const result = await svc.getRecords('u1');

    expect(result).toEqual({ static: null, llm: null });
    expect(cache.set).toHaveBeenCalled();
  });

  it('markStale updates records and invalidates cache without throwing when cache.del fails', async () => {
    const { prisma, cache, svc } = build();
    vi.mocked(cache.del).mockRejectedValue(new Error('redis down'));

    await expect(svc.markStale('u1')).resolves.toBeUndefined();

    expect(prisma.medicineRiskCheckRecord.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: { stale: true },
    });
  });

  it('runStaticCheck evaluates risk for an existing user with eligible medicines', async () => {
    const { prisma, medicinesService, riskDetection, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
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
        },
        {
          id: 'm2',
          source: 'custom',
          sourceRefId: 'local-1',
          displayName: '自制药',
          startedAt: new Date('2026-06-01T00:00:00.000Z'),
        },
        {
          id: 'm3',
          source: 'cn',
          sourceRefId: '',
          displayName: '无引用药',
          startedAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      ],
    } as never);
    vi.mocked(medicinesService.getDetailWithCache).mockResolvedValue({
      id: 'detail-cn-1',
      name: '对乙酰氨基酚',
      ingredients: [],
    } as never);
    vi.mocked(prisma.medicineRiskCheckRecord.upsert).mockResolvedValue(
      recordRow as never,
    );

    const result = await svc.runStaticCheck('u1');

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
    const { prisma, medicinesService, riskDetection, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      allergies: [],
      conditions: [],
      currentMedicines: [
        {
          id: 'm1',
          source: 'drugbank',
          sourceRefId: 'db-1',
          displayName: 'DrugA',
          startedAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      ],
    } as never);
    vi.mocked(medicinesService.getDetailWithCache).mockRejectedValue(
      new Error('db down'),
    );
    vi.mocked(prisma.medicineRiskCheckRecord.upsert).mockResolvedValue(
      recordRow as never,
    );

    await svc.runStaticCheck('u1');

    expect(riskDetection.evaluateStaticRisk).toHaveBeenCalledWith(
      [],
      [],
      expect.arrayContaining([expect.objectContaining({ id: 'm1' })]),
    );
  });

  it('runStaticCheck tolerates cache invalidation failure during persist', async () => {
    const { prisma, cache, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.medicineRiskCheckRecord.upsert).mockResolvedValue(
      recordRow as never,
    );
    vi.mocked(cache.del).mockRejectedValue(new Error('redis down'));

    await expect(svc.runStaticCheck('u1')).resolves.toMatchObject({
      checkType: 'static',
    });
  });

  it('runLlmCheck maps llm findings without secondary medicine', async () => {
    const { prisma, llmGenerator, riskContextBuilder, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    const llmRecord = {
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
    vi.mocked(prisma.medicineRiskCheckRecord.upsert).mockResolvedValue(
      llmRecord as never,
    );
    vi.mocked(riskContextBuilder.buildLlmContext).mockResolvedValue(
      {} as never,
    );
    vi.mocked(llmGenerator.generate).mockResolvedValue({
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
    } as never);

    const result = await svc.runLlmCheck('u1');

    expect(result.result.findings[0]).not.toHaveProperty(
      'secondaryMedicineName',
    );
    expect(result.result).not.toHaveProperty('overallRecommendation');
  });
});
