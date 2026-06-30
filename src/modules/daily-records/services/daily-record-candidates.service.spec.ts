import { ServiceUnavailableException } from '@nestjs/common';
import { DailyRecordCandidatesService } from './daily-record-candidates.service';
import type { DailyRecordCandidatesCopyService } from './daily-record-candidates-copy.service';
import type { DailyRecordCandidatesGeneratorService } from './daily-record-candidates-generator.service';

describe('DailyRecordCandidatesService', () => {
  it('returns generated candidates when language model is configured', async () => {
    const service = createService();

    const result = await service.generate(
      {
        text: '今天头疼，早上喝了两杯水。',
        occurredAt: '2026-06-14',
      },
      'zh-CN',
    );

    expect(result.locale).toBe('zh-CN');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.kind).toBe('symptom');
  });

  it('falls back to a note candidate when generation fails', async () => {
    const service = createService({
      generateImpl: jest.fn().mockRejectedValue(new Error('model failed')),
    });

    const result = await service.generate(
      {
        text: '今天头疼，早上喝了两杯水。',
        occurredAt: '2026-06-14',
      },
      'zh-CN',
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.kind).toBe('note');
    expect(result.items[0]?.note).toBe('今天头疼，早上喝了两杯水。');
  });

  it('throws when language model config is missing', async () => {
    const service = createService({
      hasAnalysisModel: false,
    });

    await expect(
      service.generate(
        {
          text: '今天头疼，早上喝了两杯水。',
          occurredAt: '2026-06-14',
        },
        'zh-CN',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  function createService(options?: {
    hasAnalysisModel?: boolean;
    generateImpl?: jest.Mock;
  }) {
    const copyService = {
      resolveLocale: jest.fn((language: string | undefined) => {
        const normalized = language?.trim().toLowerCase() ?? '';
        return normalized.startsWith('zh') ? 'zh-CN' : 'en';
      }),
      serviceUnavailable: jest.fn((locale: string) =>
        locale === 'zh-CN'
          ? '自然语言记录解析服务尚未配置'
          : 'Natural-language record parsing is not configured',
      ),
      confirmationHint: jest.fn((locale: string) =>
        locale === 'zh-CN'
          ? '这些只是候选记录，确认后再保存到今日记录中。'
          : 'Review these candidates before saving them to your daily records.',
      ),
      buildPromptCopy: jest.fn(() => ({
        userIntro: 'intro',
        tone: 'tone',
        actionLabelHint: 'hint',
        factsLabel: 'facts',
      })),
      buildFallback: jest.fn(
        (text: string, occurredAt: string, locale: string) => ({
          locale,
          generatedAt: '2026-06-14T10:20:30.000Z',
          confirmationHint:
            locale === 'zh-CN'
              ? '这些只是候选记录，确认后再保存到今日记录中。'
              : 'Review these candidates before saving them to your daily records.',
          items: [
            {
              kind: 'note' as const,
              occurredAt,
              title:
                locale === 'zh-CN'
                  ? '导入的备注候选'
                  : 'Imported note candidate',
              value: null,
              unit: null,
              note: text,
              payload: null,
              rationale:
                locale === 'zh-CN'
                  ? '这段内容暂时无法安全结构化，先保留为备注候选。'
                  : 'The note could not be safely structured, so it is kept as a note candidate.',
            },
          ],
        }),
      ),
    } as unknown as DailyRecordCandidatesCopyService;

    const generatorService = {
      hasAnalysisModel: jest
        .fn()
        .mockReturnValue(options?.hasAnalysisModel ?? true),
      generate:
        options?.generateImpl ??
        jest.fn().mockResolvedValue({
          items: [
            {
              kind: 'symptom',
              occurredAt: '2026-06-14',
              title: 'Headache',
              value: null,
              unit: null,
              note: '今天头疼',
              payload: null,
              rationale: 'Detected symptom from “今天头疼”.',
            },
            {
              kind: 'water',
              occurredAt: '2026-06-14',
              title: null,
              value: '2',
              unit: 'cups',
              note: null,
              payload: null,
              rationale: 'Detected water intake from “喝了两杯水”.',
            },
          ],
        }),
    } as unknown as DailyRecordCandidatesGeneratorService;

    return new DailyRecordCandidatesService(copyService, generatorService);
  }
});
