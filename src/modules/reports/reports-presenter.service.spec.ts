import { ReportsPresenterService } from './reports-presenter.service';

describe('ReportsPresenterService', () => {
  const service = new ReportsPresenterService();

  it('builds zh-CN score summary from metric statuses', () => {
    const score = service.buildScore([
      'good',
      'needs_attention',
      'insufficient_data',
    ]);

    expect(score.value).toBeGreaterThan(0);
    expect(score.summary).toContain('本周用药完成较稳');
    expect(score.summary).toContain('饮水仍有提升空间');
    expect(score.summary).toContain('睡眠数据暂不足');
  });

  it('builds findings and patterns from computed series', () => {
    const findings = service.buildFindings({
      medicationSeries: [80, 90, 85, 90, 88, 0, 0],
      waterSeries: [1.0, 1.2, 1.1, 1.3, 1.4, 1.8, 2.0],
      sleepStatus: 'insufficient_data',
    });
    const patterns = service.buildPatterns({
      medicationSeries: [80, 90, 85, 90, 88, 0, 0],
      waterSeries: [1.0, 1.2, 1.1, 1.3, 1.4, 1.8, 2.0],
      sleepSeries: [0, 0, 0, 0, 0, 0, 0],
    });

    expect(findings).toHaveLength(3);
    expect(findings[0]?.kind).toBe('hydration');
    expect(patterns).toHaveLength(3);
    expect(patterns[2]?.kind).toBe('sleep');
  });
});
