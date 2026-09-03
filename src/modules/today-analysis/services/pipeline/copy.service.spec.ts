import type { I18nService } from 'nestjs-i18n';
import { TodayAnalysisCopyService } from './copy.service.js';

describe('TodayAnalysisCopyService', () => {
  const service = new TodayAnalysisCopyService({
    t: vi.fn(
      (
        key: string,
        options?: { lang?: string; args?: Record<string, string | number> },
      ) => {
        const lang = options?.lang ?? 'en';
        return `${lang}:${key}:${JSON.stringify(options?.args ?? {})}`;
      },
    ),
  } as unknown as I18nService);

  it('normalizes locale from request language', () => {
    expect(service.resolveLocale('zh-CN')).toBe('zh-CN');
    expect(service.resolveLocale('zh')).toBe('zh-CN');
    expect(service.resolveLocale('en-US')).toBe('en');
    expect(service.resolveLocale(undefined)).toBe('en');
  });

  it('builds prompt copy with localized action label dependency', () => {
    const copy = service.buildPromptCopy('zh-CN');

    expect(copy.userIntro).toContain('zh-CN:today-analysis.prompt.user_intro');
    expect(copy.actionLabelHint).toContain(
      'zh-CN:today-analysis.prompt.action_label_hint',
    );
  });

  it('builds localized fallback content', () => {
    const fallback = service.buildFallback(
      {
        date: '2026-06-12',
        water: {
          completedCount: 4,
          targetCount: 8,
          remainingCount: 4,
          observedMetric: {
            value: 1000,
            state: 'observed',
            coverage: 'sufficient',
            sources: ['manual'],
            observedCount: 4,
            expectedCount: null,
            windowStart: '2026-06-12T00:00:00.000Z',
            windowEnd: '2026-06-13T00:00:00.000Z',
          },
        },
        medication: {
          medicineCount: 2,
          pendingCount: 1,
          nextDoseTimeLabel: '20:00',
          nextMedicineName: 'Vitamin B',
          currentMedicineNames: ['Vitamin B'],
        },
        recordSummary: [],
        recentRecords: [],
        sleep: {
          status: 'insufficient_data',
          durationMinutes: null,
          quality: null,
          startAt: null,
          endAt: null,
          deepMinutes: null,
          lightMinutes: null,
          remMinutes: null,
        },
        lowRiskContext: {
          activeAllergyCount: 0,
          currentMedicineCount: 2,
        },
      },
      'en',
    );

    expect(fallback.summary).toContain(
      'en:today-analysis.fallback.summary_medication_and_hydration',
    );
    expect(fallback.bullets).toHaveLength(3);
    expect(fallback.actionLabel).toContain(
      'en:today-analysis.fallback.action_label',
    );
  });

  it('builds medication-only and hydration-only summary variants', () => {
    const medicationOnly = service.buildFallback(
      {
        date: '2026-06-12',
        water: {
          completedCount: 8,
          targetCount: 8,
          remainingCount: 0,
        },
        medication: {
          medicineCount: 1,
          pendingCount: 2,
          nextDoseTimeLabel: '20:00',
          nextMedicineName: 'Vitamin B',
          currentMedicineNames: ['Vitamin B'],
        },
        recordSummary: [],
        recentRecords: [],
        sleep: {
          status: 'insufficient_data',
          durationMinutes: null,
          quality: null,
          startAt: null,
          endAt: null,
          deepMinutes: null,
          lightMinutes: null,
          remMinutes: null,
        },
        lowRiskContext: {
          activeAllergyCount: 0,
          currentMedicineCount: 1,
        },
      },
      'en',
    );
    expect(medicationOnly.summary).toContain(
      'en:today-analysis.fallback.summary_medication_only',
    );

    const hydrationOnly = service.buildFallback(
      {
        date: '2026-06-12',
        water: {
          completedCount: 2,
          targetCount: 8,
          remainingCount: 6,
          observedMetric: {
            value: 500,
            state: 'observed',
            coverage: 'sufficient',
            sources: ['manual'],
            observedCount: 2,
            expectedCount: null,
            windowStart: '2026-06-12T00:00:00.000Z',
            windowEnd: '2026-06-13T00:00:00.000Z',
          },
        },
        medication: {
          medicineCount: 0,
          pendingCount: 0,
          nextDoseTimeLabel: '',
          nextMedicineName: '',
          currentMedicineNames: [],
        },
        recordSummary: [],
        recentRecords: [],
        sleep: {
          status: 'insufficient_data',
          durationMinutes: null,
          quality: null,
          startAt: null,
          endAt: null,
          deepMinutes: null,
          lightMinutes: null,
          remMinutes: null,
        },
        lowRiskContext: {
          activeAllergyCount: 0,
          currentMedicineCount: 0,
        },
      },
      'en',
    );
    expect(hydrationOnly.summary).toContain(
      'en:today-analysis.fallback.summary_hydration_only',
    );
  });

  it('builds default summary and done bullets for empty data', () => {
    const fallback = service.buildFallback(
      {
        date: '2026-06-12',
        water: {
          completedCount: 8,
          targetCount: 8,
          remainingCount: 0,
        },
        medication: {
          medicineCount: 0,
          pendingCount: 0,
          nextDoseTimeLabel: '',
          nextMedicineName: '',
          currentMedicineNames: [],
        },
        recordSummary: [],
        recentRecords: [],
        sleep: {
          status: 'insufficient_data',
          durationMinutes: null,
          quality: null,
          startAt: null,
          endAt: null,
          deepMinutes: null,
          lightMinutes: null,
          remMinutes: null,
        },
        lowRiskContext: {
          activeAllergyCount: 0,
          currentMedicineCount: 0,
        },
      },
      'en',
    );

    expect(fallback.summary).toContain(
      'en:today-analysis.fallback.summary_default',
    );
    expect(fallback.bullets[0]?.text).toContain(
      'en:today-analysis.fallback.bullet_medication_done',
    );
    expect(fallback.bullets[1]?.text).toContain(
      'en:today-analysis.fallback.bullet_hydration_done',
    );
  });

  it('builds summaries-disabled copy with locale passthrough', () => {
    expect(service.summariesDisabled('zh-CN')).toContain(
      'zh-CN:today-analysis.summaries_disabled',
    );
  });
});
