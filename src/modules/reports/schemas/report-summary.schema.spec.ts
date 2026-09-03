import { reportSummarySchema } from './report-summary.schema.js';

describe('reportSummarySchema', () => {
  function buildValid(overrides: Record<string, unknown> = {}) {
    return {
      summary: '近 7 天有 5 天记录了用药数据，饮水数据覆盖率较低。',
      coverage: {
        medication: { trackedDays: 5, totalDays: 7 },
        water: { trackedDays: 3, totalDays: 7 },
        sleep: { trackedDays: 0, totalDays: 7 },
      },
      observedPattern: {
        kind: 'medication' as const,
        text: '用药完成率连续 5 天保持在 80% 以上。',
        source: 'reminder_plan',
      },
      lowRiskAction: {
        label: '查看报告',
        text: '继续按当前节奏记录日常饮水量。',
      },
      disclaimer: '仅基于近 7 天已记录数据，不构成诊断或治疗建议。',
      ...overrides,
    };
  }

  it('accepts a valid report summary', () => {
    const result = reportSummarySchema.safeParse(buildValid());
    expect(result.success).toBe(true);
  });

  it('accepts null observedPattern (data insufficient)', () => {
    const result = reportSummarySchema.safeParse(
      buildValid({ observedPattern: null }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts null lowRiskAction', () => {
    const result = reportSummarySchema.safeParse(
      buildValid({ lowRiskAction: null }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects summary exceeding 160 chars', () => {
    const result = reportSummarySchema.safeParse(
      buildValid({ summary: 'x'.repeat(161) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects empty summary', () => {
    const result = reportSummarySchema.safeParse(buildValid({ summary: '  ' }));
    expect(result.success).toBe(false);
  });

  it('rejects invalid observedPattern kind', () => {
    const result = reportSummarySchema.safeParse(
      buildValid({
        observedPattern: { kind: 'invalid', text: 'text', source: 'src' },
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects observedPattern text exceeding 96 chars', () => {
    const result = reportSummarySchema.safeParse(
      buildValid({
        observedPattern: {
          kind: 'medication',
          text: 'x'.repeat(97),
          source: 'reminder_plan',
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects lowRiskAction label exceeding 24 chars', () => {
    const result = reportSummarySchema.safeParse(
      buildValid({
        lowRiskAction: { label: 'x'.repeat(25), text: 'ok' },
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects disclaimer exceeding 120 chars', () => {
    const result = reportSummarySchema.safeParse(
      buildValid({ disclaimer: 'x'.repeat(121) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects missing coverage', () => {
    const result = reportSummarySchema.safeParse(
      buildValid({ coverage: undefined }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects negative trackedDays', () => {
    const result = reportSummarySchema.safeParse(
      buildValid({
        coverage: {
          medication: { trackedDays: -1, totalDays: 7 },
          water: { trackedDays: 3, totalDays: 7 },
          sleep: { trackedDays: 0, totalDays: 7 },
        },
      }),
    );
    expect(result.success).toBe(false);
  });
});
