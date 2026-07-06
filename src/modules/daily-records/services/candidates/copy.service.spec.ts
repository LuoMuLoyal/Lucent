import { Test } from '@nestjs/testing';
import { I18nService } from 'nestjs-i18n';
import { DailyRecordCandidatesCopyService } from '../candidates/copy.service';

describe('DailyRecordCandidatesCopyService', () => {
  let service: DailyRecordCandidatesCopyService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DailyRecordCandidatesCopyService,
        {
          provide: I18nService,
          useValue: { t: jest.fn((key: string) => key) },
        },
      ],
    }).compile();

    service = module.get(DailyRecordCandidatesCopyService);
  });

  describe('confirmationHint', () => {
    it('returns the confirmation hint for zh locale', () => {
      // The t() method from LocalizedCopyService uses nestjs-i18n under the hood.
      // In tests without the full i18n module, it falls back to returning the key.
      const hint = service.confirmationHint('zh-CN');
      expect(typeof hint).toBe('string');
    });
  });

  describe('buildFallback', () => {
    it('builds a note candidate with trimmed text', () => {
      const result = service.buildFallback('  头疼  ', '2026-06-15', 'zh-CN');

      expect(result.locale).toBe('zh-CN');
      expect(result.generatedAt).toBeDefined();
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        kind: 'note',
        occurredAt: '2026-06-15',
        note: '头疼',
        value: null,
        unit: null,
        payload: null,
      });
    });

    it('includes i18n keys for fallback title and rationale', () => {
      const result = service.buildFallback('test', '2026-06-15', 'en');
      const items = result.items;
      expect(items).toBeDefined();
      expect(typeof items[0]?.title).toBe('string');
      expect(typeof items[0]?.rationale).toBe('string');
      expect(typeof result.confirmationHint).toBe('string');
    });
  });
});
