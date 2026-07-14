import {
  reportSummarySchema,
  REPORT_SUMMARY_BULLET_KINDS,
} from './report-summary.schema';

describe('reportSummarySchema', () => {
  function buildValid(overrides: Record<string, unknown> = {}) {
    return {
      summary: '本周健康状况良好',
      bullets: [
        { kind: 'medication', text: '按时服药' },
        { kind: 'hydration', text: '饮水充足' },
      ],
      actionLabel: '查看详情',
      action: 'view_report',
      confidenceNote: '基于最近7天数据',
      ...overrides,
    };
  }

  it('accepts a valid report summary', () => {
    const result = reportSummarySchema.safeParse(buildValid());
    expect(result.success).toBe(true);
  });

  it('accepts all valid bullet kinds', () => {
    const bullets = REPORT_SUMMARY_BULLET_KINDS.map((kind) => ({
      kind,
      text: 'text',
    }));
    // Use first 3 to stay within max
    const result = reportSummarySchema.safeParse(
      buildValid({ bullets: bullets.slice(0, 3) }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects an invalid bullet kind', () => {
    const result = reportSummarySchema.safeParse(
      buildValid({
        bullets: [{ kind: 'invalid', text: 'text' }],
      }),
    );
    expect(result.success).toBe(false);
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

  it('rejects bullets with fewer than 2 items', () => {
    const result = reportSummarySchema.safeParse(
      buildValid({ bullets: [{ kind: 'general', text: 'only one' }] }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects bullets with more than 3 items', () => {
    const result = reportSummarySchema.safeParse({
      ...buildValid(),
      bullets: [
        { kind: 'medication', text: 'a' },
        { kind: 'hydration', text: 'b' },
        { kind: 'sleep', text: 'c' },
        { kind: 'general', text: 'd' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects bullet text exceeding 96 chars', () => {
    const result = reportSummarySchema.safeParse(
      buildValid({
        bullets: [
          { kind: 'medication', text: 'x'.repeat(97) },
          { kind: 'hydration', text: 'ok' },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects actionLabel exceeding 24 chars', () => {
    const result = reportSummarySchema.safeParse(
      buildValid({ actionLabel: 'x'.repeat(25) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects action exceeding 24 chars', () => {
    const result = reportSummarySchema.safeParse(
      buildValid({ action: 'x'.repeat(25) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects confidenceNote exceeding 96 chars', () => {
    const result = reportSummarySchema.safeParse(
      buildValid({ confidenceNote: 'x'.repeat(97) }),
    );
    expect(result.success).toBe(false);
  });
});
