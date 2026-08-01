import { describe, expect, it, vi } from 'vitest';
import { RiskContextBuilderService } from './risk-context-builder.service';
import type { PrismaService } from '../../../../prisma';
import type { MedicinesService } from '../medicines.service';

function userRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    allergies: [
      { label: '青霉素', reaction: null, severity: 'severe', isActive: true },
    ],
    conditions: [{ label: '高血压', status: 'active' }],
    currentMedicines: [
      {
        id: 'cm1',
        source: 'cn',
        sourceRefId: 'cn-1',
        displayName: '布洛芬缓释胶囊',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        isCurrent: true,
      },
    ],
    ...overrides,
  };
}

function build() {
  const prisma = {
    user: { findFirst: vi.fn() },
    userMedicineReminder: { findMany: vi.fn() },
  } as unknown as PrismaService;
  const medicinesService = {
    getDetailWithCache: vi.fn(),
  } as unknown as MedicinesService;
  const svc = new RiskContextBuilderService(prisma, medicinesService);
  return { prisma, medicinesService, svc };
}

const staticResult = {
  overallRiskLevel: 'caution',
  overallRiskScore: 15,
  currentMedicineCount: 1,
  checkedMedicineCount: 1,
  findings: [
    {
      type: 'allergy',
      severity: 'high',
      primaryMedicineName: '布洛芬缓释胶囊',
      relatedLabel: '青霉素',
      evidence: 'contraindications text',
    },
  ],
  coverageIssues: [],
  redFlags: [],
} as never;

describe('RiskContextBuilderService.buildLlmContext', () => {
  it('returns empty sections when user is missing', async () => {
    const { prisma, medicinesService, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.userMedicineReminder.findMany).mockResolvedValue([]);

    const ctx = await svc.buildLlmContext('u1', staticResult);

    expect(ctx.medicines).toEqual([]);
    expect(ctx.allergies).toEqual([]);
    expect(ctx.conditions).toEqual([]);
    expect(ctx.reminders).toEqual([]);
    expect(medicinesService.getDetailWithCache).not.toHaveBeenCalled();
  });

  it('assembles medicine detail and skips rejected detail fetches', async () => {
    const { prisma, medicinesService, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(userRecord());
    vi.mocked(prisma.userMedicineReminder.findMany).mockResolvedValue([]);
    vi.mocked(medicinesService.getDetailWithCache)
      .mockResolvedValueOnce({
        id: 'cn-1',
        source: 'cn',
        name: '布洛芬缓释胶囊',
        detail: {
          ingredients: '布洛芬',
          contraindications: '胃溃疡',
          precautions: '饭后服用',
          foodInteractions: ['酒', 42],
          drugInteractions: [
            { drugbankId: 'DB0001', description: '相互作用说明' },
            { drugbankId: '', description: 'x' },
          ],
        },
      } as never)
      .mockRejectedValueOnce(new Error('fetch failed'));

    const ctx = await svc.buildLlmContext('u1', staticResult);

    expect(ctx.medicines).toHaveLength(1);
    expect(ctx.medicines[0]).toMatchObject({
      name: '布洛芬缓释胶囊',
      source: 'cn',
      ingredients: '布洛芬',
      contraindications: '胃溃疡',
      precautions: '饭后服用',
      foodInteractions: ['酒'],
      // 仅过滤非字符串类型；空 drugbankId 仍保留
      drugInteractions: [
        { target: 'DB0001', description: '相互作用说明' },
        { target: '', description: 'x' },
      ],
      startedAt: '2026-01-01',
    });
    // reaction 为 null 时字段被省略
    expect(ctx.allergies).toEqual([{ label: '青霉素', severity: 'severe' }]);
    expect(ctx.conditions).toEqual([{ label: '高血压', status: 'active' }]);
  });

  it('filters reminders that do not map to a current medicine and keeps numeric daysOfWeek', async () => {
    const { prisma, medicinesService, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(userRecord());
    vi.mocked(prisma.userMedicineReminder.findMany).mockResolvedValue([
      {
        id: 'r1',
        currentMedicineId: 'cm1',
        scheduledHour: 8,
        scheduledMinute: 30,
        daysOfWeek: [1, 'bad'],
        startDate: new Date('2026-01-01'),
        endDate: null,
        isActive: true,
      },
      {
        id: 'r2',
        currentMedicineId: 'ghost',
        scheduledHour: 9,
        scheduledMinute: 0,
        daysOfWeek: null,
        startDate: null,
        endDate: null,
        isActive: true,
      },
    ]);
    vi.mocked(medicinesService.getDetailWithCache).mockResolvedValue({
      id: 'cn-1',
      source: 'cn',
      name: '布洛芬缓释胶囊',
      detail: {},
    } as never);

    const ctx = await svc.buildLlmContext('u1', staticResult);

    expect(ctx.reminders).toEqual([
      {
        medicineName: '布洛芬缓释胶囊',
        scheduledHour: 8,
        scheduledMinute: 30,
        daysOfWeek: [1],
        startDate: '2026-01-01',
      },
    ]);
  });

  it('serializes static findings with secondary and evidence', async () => {
    const { prisma, medicinesService, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(userRecord());
    vi.mocked(prisma.userMedicineReminder.findMany).mockResolvedValue([]);
    vi.mocked(medicinesService.getDetailWithCache).mockResolvedValue({
      id: 'cn-1',
      source: 'cn',
      name: '布洛芬缓释胶囊',
      detail: {},
    } as never);

    const ctx = await svc.buildLlmContext('u1', staticResult);

    expect(ctx.staticFindings).toEqual([
      {
        type: 'allergy',
        severity: 'high',
        description:
          '布洛芬缓释胶囊 (allergen: 青霉素) — contraindications text',
      },
    ]);
  });
});
