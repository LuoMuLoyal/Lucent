import {
  todayAnalysisSchema,
  TODAY_ANALYSIS_BULLET_KINDS,
} from './analysis.schema';

describe('todayAnalysisSchema', () => {
  function buildValid(overrides: Record<string, unknown> = {}) {
    return {
      summary: '今日健康状态良好',
      bullets: [
        { kind: 'medication', text: '按时服药' },
        { kind: 'hydration', text: '饮水充足' },
      ],
      actionLabel: '查看建议',
      action: 'view_suggestions',
      confidenceNote: '基于今日数据',
      ...overrides,
    };
  }

  it('accepts a valid today analysis', () => {
    const result = todayAnalysisSchema.safeParse(buildValid());
    expect(result.success).toBe(true);
  });

  it('accepts all valid bullet kinds', () => {
    const bullets = TODAY_ANALYSIS_BULLET_KINDS.map((kind) => ({
      kind,
      text: 'text',
    }));
    const result = todayAnalysisSchema.safeParse(
      buildValid({ bullets: bullets.slice(0, 3) }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects an invalid bullet kind', () => {
    const result = todayAnalysisSchema.safeParse(
      buildValid({
        bullets: [{ kind: 'invalid', text: 'text' }],
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects summary exceeding 120 chars', () => {
    const result = todayAnalysisSchema.safeParse(
      buildValid({ summary: 'x'.repeat(121) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects empty summary', () => {
    const result = todayAnalysisSchema.safeParse(buildValid({ summary: '  ' }));
    expect(result.success).toBe(false);
  });

  it('rejects bullets with fewer than 2 items', () => {
    const result = todayAnalysisSchema.safeParse(
      buildValid({ bullets: [{ kind: 'general', text: 'only one' }] }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects bullets with more than 3 items', () => {
    const result = todayAnalysisSchema.safeParse({
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

  it('rejects bullet text exceeding 80 chars', () => {
    const result = todayAnalysisSchema.safeParse(
      buildValid({
        bullets: [
          { kind: 'medication', text: 'x'.repeat(81) },
          { kind: 'hydration', text: 'ok' },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects confidenceNote exceeding 80 chars', () => {
    const result = todayAnalysisSchema.safeParse(
      buildValid({ confidenceNote: 'x'.repeat(81) }),
    );
    expect(result.success).toBe(false);
  });
});
