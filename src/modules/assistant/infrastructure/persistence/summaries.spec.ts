/**
 * Prisma mapping and fence tests for `PrismaSummaries`.
 *
 * The version rule itself lives in `domain/summary/summary.ts`; these tests cover
 * the storage half: the fence is applied against the **stored** version, the
 * unique-key race is re-checked, and rows map to the read shapes the reports
 * context consumes.
 */
import type { DeepMocked } from '../../../../common/types/deep-mocked.js';
import { AiSummaryHistoryKind } from '#generated/prisma/client.js';
import { PrismaSummaries } from './summaries.js';
import type { PrismaService } from '../../../../prisma/index.js';

const T0 = new Date('2026-10-25T08:00:00.000Z');

function todayWrite(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    kind: 'today' as const,
    date: '2026-10-25',
    generatedAt: T0.toISOString(),
    summary: 'text',
    bullets: [{ kind: 'water', text: '300ml' }],
    actionLabel: 'a',
    action: 'b',
    confidenceNote: 'c',
    aiGenerated: true,
    ...overrides,
  };
}

describe('PrismaSummaries', () => {
  let repository: PrismaSummaries;
  let prisma: DeepMocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      assistantSummaryHistory: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
      },
    } as unknown as DeepMocked<PrismaService>;
    repository = new PrismaSummaries(prisma);
  });

  it('derives the storage key from the scope, not from the caller', async () => {
    prisma.assistantSummaryHistory.findUnique.mockResolvedValue(null);
    prisma.assistantSummaryHistory.create.mockResolvedValue({} as never);

    await repository.save(todayWrite({ sourceVersion: 1 }));

    expect(prisma.assistantSummaryHistory.findUnique).toHaveBeenCalledWith({
      where: {
        userId_scopeKey: { userId: 'user-1', scopeKey: 'today:2026-10-25' },
      },
      select: { sourceVersion: true },
    });
  });

  it('refuses a write whose version is not newer than the stored one', async () => {
    prisma.assistantSummaryHistory.findUnique.mockResolvedValue({
      sourceVersion: 3,
    } as never);

    const result = await repository.save(todayWrite({ sourceVersion: 3 }));

    expect(result).toEqual({ written: false });
    expect(prisma.assistantSummaryHistory.updateMany).not.toHaveBeenCalled();
  });

  it('writes a strictly newer version', async () => {
    prisma.assistantSummaryHistory.findUnique.mockResolvedValue({
      sourceVersion: 3,
    } as never);
    prisma.assistantSummaryHistory.updateMany.mockResolvedValue({
      count: 1,
    } as never);

    const result = await repository.save(todayWrite({ sourceVersion: 4 }));

    expect(result).toEqual({ written: true });
    expect(prisma.assistantSummaryHistory.updateMany).toHaveBeenCalled();
  });

  it('re-checks the fence when another writer won the unique-key race', async () => {
    prisma.assistantSummaryHistory.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ sourceVersion: 9 } as never);
    prisma.assistantSummaryHistory.create.mockRejectedValue({ code: 'P2002' });

    const result = await repository.save(todayWrite({ sourceVersion: 2 }));

    expect(result).toEqual({ written: false });
    expect(prisma.assistantSummaryHistory.updateMany).not.toHaveBeenCalled();
  });

  it('returns no row for an unaddressable scope', async () => {
    const result = await repository.save({
      userId: 'user-1',
      kind: 'today',
      date: null,
      generatedAt: T0.toISOString(),
      summary: 'x',
    });

    expect(result).toEqual({ written: false });
  });

  it('maps a today row to the read shape', async () => {
    prisma.assistantSummaryHistory.findMany.mockResolvedValue([
      {
        date: T0,
        generatedAt: T0,
        summary: 's',
        bullets: [{ kind: 'water', text: '300ml' }],
        actionLabel: 'a',
        action: 'b',
        confidenceNote: 'c',
        aiGenerated: true,
        sourceVersion: 2,
      },
    ] as never);

    const [record] = await repository.listRecentToday('user-1', 7);

    expect(record).toEqual(
      expect.objectContaining({
        date: '2026-10-25',
        bullets: [{ kind: 'water', text: '300ml' }],
        sourceVersion: 2,
      }),
    );
  });

  it('queries report rows by kind', async () => {
    prisma.assistantSummaryHistory.findMany.mockResolvedValue([]);

    await repository.listRecentReports('user-1', 6);

    expect(prisma.assistantSummaryHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', kind: AiSummaryHistoryKind.report },
      }),
    );
  });

  it('maps a report row payload into the read shape', async () => {
    prisma.assistantSummaryHistory.findFirst.mockResolvedValue({
      rangeKey: 'last_7_days',
      startDate: T0,
      endDate: T0,
      generatedAt: T0,
      summary: 's',
      bullets: [],
      actionLabel: '',
      action: '',
      confidenceNote: '',
      payload: {
        coverage: {
          medication: { trackedDays: 5, totalDays: 7 },
          water: { trackedDays: 5, totalDays: 7 },
          sleep: { trackedDays: 5, totalDays: 7 },
        },
        observedPattern: null,
        lowRiskAction: null,
        disclaimer: 'd',
      },
    } as never);

    const record = await repository.findReportByRange('user-1', {
      rangeKey: 'last_7_days',
    });

    expect(record?.disclaimer).toBe('d');
    expect(record?.coverage?.medication.trackedDays).toBe(5);
  });
});
