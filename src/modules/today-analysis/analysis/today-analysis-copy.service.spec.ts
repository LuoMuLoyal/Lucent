import type { I18nService } from 'nestjs-i18n';
import { TodayAnalysisCopyService } from './today-analysis-copy.service';

describe('TodayAnalysisCopyService', () => {
  const service = new TodayAnalysisCopyService({
    t: jest.fn(
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
});
