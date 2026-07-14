import { explanationSchema } from './explanation.schema';

describe('explanationSchema', () => {
  function buildValid(overrides: Record<string, unknown> = {}) {
    return {
      reason: '您今日饮水量不足，建议补充水分',
      boundary: '本建议仅供参考，不替代医生诊断',
      ...overrides,
    };
  }

  it('accepts a valid explanation', () => {
    const result = explanationSchema.safeParse(buildValid());
    expect(result.success).toBe(true);
  });

  it('rejects empty reason', () => {
    const result = explanationSchema.safeParse(buildValid({ reason: '  ' }));
    expect(result.success).toBe(false);
  });

  it('rejects reason exceeding 300 chars', () => {
    const result = explanationSchema.safeParse(
      buildValid({ reason: 'x'.repeat(301) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects empty boundary', () => {
    const result = explanationSchema.safeParse(buildValid({ boundary: '  ' }));
    expect(result.success).toBe(false);
  });

  it('rejects boundary exceeding 200 chars', () => {
    const result = explanationSchema.safeParse(
      buildValid({ boundary: 'x'.repeat(201) }),
    );
    expect(result.success).toBe(false);
  });

  it('trims whitespace from valid input', () => {
    const result = explanationSchema.safeParse({
      reason: '  有效原因  ',
      boundary: '  有效边界  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBe('有效原因');
      expect(result.data.boundary).toBe('有效边界');
    }
  });
});
