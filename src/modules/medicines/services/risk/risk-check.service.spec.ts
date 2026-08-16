import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
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

  it('runLlmCheck throws ServiceUnavailableException when the LLM analysis model is not configured', async () => {
    const { llmGenerator, svc } = build();
    vi.mocked(llmGenerator.hasAnalysisModel).mockReturnValue(false);

    await expect(svc.runLlmCheck('u1')).rejects.toThrow(
      ServiceUnavailableException,
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

  it('markStale retries cache invalidation on first failure and succeeds on retry', async () => {
    const { prisma, cache, svc } = build();
    vi.mocked(cache.del)
      .mockRejectedValueOnce(new Error('redis timeout'))
      .mockResolvedValueOnce(true);
    vi.mocked(prisma.medicineRiskCheckRecord.updateMany).mockResolvedValue({
      count: 1,
    } as never);

    await svc.markStale('u1');

    expect(cache.del).toHaveBeenCalledTimes(2);
  });

  it('markStale updates records and logs error when cache.del fails after retry', async () => {
    const { prisma, cache, svc } = build();
    vi.mocked(cache.del).mockRejectedValue(new Error('redis down'));
    const errorSpy = vi
      .spyOn(svc['logger'], 'error')
      .mockImplementation(() => undefined);

    await expect(svc.markStale('u1')).resolves.toBeUndefined();

    expect(prisma.medicineRiskCheckRecord.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: { stale: true },
    });
    expect(cache.del).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalled();
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

  it('runStaticCheck tolerates cache invalidation failure during persist (retries then logs error)', async () => {
    const { prisma, cache, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.medicineRiskCheckRecord.upsert).mockResolvedValue(
      recordRow as never,
    );
    vi.mocked(cache.del).mockRejectedValue(new Error('redis down'));
    const errorSpy = vi
      .spyOn(svc['logger'], 'error')
      .mockImplementation(() => undefined);

    await expect(svc.runStaticCheck('u1')).resolves.toMatchObject({
      checkType: 'static',
    });

    // Should have retried
    expect(cache.del).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalled();
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

  it('runStaticCheck with a candidate includes it in the evaluation without persisting', async () => {
    const { prisma, medicinesService, riskDetection, cache, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      allergies: [],
      conditions: [],
      currentMedicines: [
        {
          id: 'm1',
          source: 'cn',
          sourceRefId: 'cn-1',
          displayName: '对乙酰氨基酚',
          startedAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      ],
    } as never);
    vi.mocked(medicinesService.getDetailWithCache).mockImplementation(
      (id: string) =>
        Promise.resolve(
          id === 'cn-1'
            ? { id: 'cn-1', name: '对乙酰氨基酚', source: 'cn' }
            : { id, name: `候选药品-${id}`, source: 'cn' },
        ) as never,
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

    const result = await svc.runStaticCheck('u1', {
      source: 'cn',
      id: 'cn-2',
    });

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
    expect(prisma.medicineRiskCheckRecord.upsert).not.toHaveBeenCalled();
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
    const { prisma, medicinesService, riskDetection, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      allergies: [],
      conditions: [],
      currentMedicines: [
        {
          id: 'm1',
          source: 'cn',
          sourceRefId: ' cn-1 ',
          displayName: '对乙酰氨基酚',
          startedAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      ],
    } as never);
    vi.mocked(medicinesService.getDetailWithCache).mockResolvedValue({
      id: 'cn-1',
      name: '对乙酰氨基酚',
      source: 'cn',
    } as never);

    const result = await svc.runStaticCheck('u1', {
      source: 'cn',
      id: 'cn-1',
    });

    // 药箱已有同 source + sourceRefId（trim 后比较），候选不再单独加入
    expect(medicinesService.getDetailWithCache).toHaveBeenCalledTimes(1);
    const [detailsArg] = vi.mocked(riskDetection.evaluateStaticRisk).mock
      .calls[0]!;
    expect(detailsArg).toHaveLength(1);
    expect(result.result.currentMedicineCount).toBe(1);
    expect(result.result.checkedMedicineCount).toBe(1);
  });

  it('runStaticCheck propagates NotFoundException when the candidate detail is missing', async () => {
    const { prisma, medicinesService, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      allergies: [],
      conditions: [],
      currentMedicines: [],
    } as never);
    vi.mocked(medicinesService.getDetailWithCache).mockRejectedValue(
      new NotFoundException('medicine not found'),
    );

    await expect(
      svc.runStaticCheck('u1', { source: 'cn', id: 'missing' }),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.medicineRiskCheckRecord.upsert).not.toHaveBeenCalled();
  });

  it('runStaticCheck wraps non-NotFound candidate resolution failures as badRequest', async () => {
    const { prisma, medicinesService, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      allergies: [],
      conditions: [],
      currentMedicines: [],
    } as never);
    vi.mocked(medicinesService.getDetailWithCache).mockRejectedValue(
      new Error('upstream timeout'),
    );

    await expect(
      svc.runStaticCheck('u1', { source: 'drugbank', id: 'DB00001' }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.medicineRiskCheckRecord.upsert).not.toHaveBeenCalled();
  });
});
