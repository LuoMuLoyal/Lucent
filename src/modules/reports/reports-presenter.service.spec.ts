import type { I18nService } from 'nestjs-i18n';
import { ReportsPresenterService } from './reports-presenter.service';

function createMockI18n(): I18nService {
  const en: Record<string, string> = {
    'reports-dashboard.findings.hydration_low_title': 'Hydration still low',
    'reports-dashboard.findings.hydration_low_body':
      '{lowWaterDays} of the last {dayCount} days had water intake below 1.5 L.',
    'reports-dashboard.findings.medication_stable_title':
      'Medication adherence is stable',
    'reports-dashboard.findings.medication_stable_body':
      '{strongDays} of the last {dayCount} days reached at least 80% medication completion.',
    'reports-dashboard.findings.sleep_insufficient_title':
      'Not enough sleep data',
    'reports-dashboard.findings.sleep_insufficient_body':
      'There is no stable sleep contract data yet, so real sleep trends are not shown.',
    'reports-dashboard.patterns.medication_title': 'Medication adherence',
    'reports-dashboard.patterns.medication_body_good':
      'This week shows medication plan activity. Keep the current rhythm.',
    'reports-dashboard.patterns.medication_body_insufficient':
      'There is not enough medication plan data to judge adherence trends.',
    'reports-dashboard.patterns.hydration_title': 'Hydration trend',
    'reports-dashboard.patterns.hydration_body_stable':
      'Hydration had some consistency this week. Keep reinforcing the habit.',
    'reports-dashboard.patterns.hydration_body_attention':
      'Hydration was not consistent enough over the last {dayCount} days. Try to stabilize daily water intake first.',
    'reports-dashboard.patterns.sleep_title': 'Sleep trend',
    'reports-dashboard.patterns.sleep_body_insufficient':
      'Sleep contract data is not persisted yet; only the missing state is kept.',
    'reports-dashboard.score.part_medication_good':
      'Medication completion was stable',
    'reports-dashboard.score.part_hydration_attention':
      'Hydration still has room to improve',
    'reports-dashboard.score.part_sleep_insufficient':
      'Sleep data is not sufficient yet',
    'reports-dashboard.score.default_summary':
      'The report data has been updated.',
  };
  return {
    t: (key: string, opts?: { args?: Record<string, string> }) => {
      let text = en[key] ?? key;
      if (opts?.args) {
        for (const [k, v] of Object.entries(opts.args)) {
          text = text.replace(`{${k}}`, v);
        }
      }
      return text;
    },
  } as unknown as I18nService;
}

describe('ReportsPresenterService', () => {
  const service = new ReportsPresenterService(createMockI18n());

  it('builds en score summary from metric statuses', () => {
    const score = service.buildScore(
      ['good', 'needs_attention', 'insufficient_data'],
      'en',
    );

    expect(score.value).toBeGreaterThan(0);
    expect(score.summary).toContain('Medication completion was stable');
    expect(score.summary).toContain('Hydration still has room to improve');
    expect(score.summary).toContain('Sleep data is not sufficient yet');
  });

  it('builds findings and patterns from computed series', () => {
    const findings = service.buildFindings(
      {
        range: 'last_7_days',
        medicationSeries: [80, 90, 85, 90, 88, 0, 0],
        waterSeries: [1.0, 1.2, 1.1, 1.3, 1.4, 1.8, 2.0],
        sleepStatus: 'insufficient_data',
      },
      'en',
    );
    const patterns = service.buildPatterns(
      {
        range: 'last_7_days',
        medicationSeries: [80, 90, 85, 90, 88, 0, 0],
        waterSeries: [1.0, 1.2, 1.1, 1.3, 1.4, 1.8, 2.0],
        sleepSeries: [0, 0, 0, 0, 0, 0, 0],
      },
      'en',
    );

    expect(findings).toHaveLength(3);
    expect(findings[0]?.kind).toBe('hydration');
    expect(patterns).toHaveLength(3);
    expect(patterns[2]?.kind).toBe('sleep');
  });

  it('uses comma separator for en locale', () => {
    const score = service.buildScore(
      ['good', 'needs_attention', 'insufficient_data'],
      'en',
    );

    expect(score.summary).toContain(', ');
    expect(score.summary.endsWith('.')).toBe(true);
  });

  it('returns default summary when no conditions match', () => {
    const score = service.buildScore(['stable', 'stable', 'stable'], 'en');

    expect(score.summary).toBe('The report data has been updated.');
  });
});
