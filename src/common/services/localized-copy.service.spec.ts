import type { I18nService } from 'nestjs-i18n';
import { LocalizedCopyService } from './localized-copy.service';
import type { PromptCopy } from '../helpers/format/localized-copy';

// ── Test fixture ───────────────────────────────────────────────────────────

class TestLocalizedCopyService extends LocalizedCopyService<PromptCopy> {
  protected readonly scope = 'test-scope';
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('LocalizedCopyService', () => {
  let i18n: vi.Mocked<I18nService>;
  let service: TestLocalizedCopyService;

  beforeEach(() => {
    i18n = {
      t: vi.fn((key: string, opts?: Record<string, unknown>) => {
        if (opts && 'args' in opts) {
          const args = opts['args'] as Record<string, string>;
          return Object.entries(args).reduce(
            (str, [k, v]) => str.replace(`{${k}}`, v),
            key,
          );
        }
        return key;
      }),
    } as unknown as vi.Mocked<I18nService>;

    service = new TestLocalizedCopyService(i18n);
  });

  describe('resolveLocale', () => {
    it('delegates to resolveLocale helper', () => {
      expect(service.resolveLocale('zh')).toBe('zh-CN');
      expect(service.resolveLocale('en')).toBe('en');
      expect(service.resolveLocale(undefined)).toBe('en');
    });
  });

  describe('serviceUnavailable', () => {
    it('calls t with scoped key', () => {
      service.serviceUnavailable('zh-CN');
      expect(i18n.t).toHaveBeenCalledWith('test-scope.service_unavailable', {
        lang: 'zh-CN',
      });
    });

    it('returns the translation', () => {
      const result = service.serviceUnavailable('en');
      expect(result).toBe('test-scope.service_unavailable');
    });
  });

  describe('buildPromptCopy', () => {
    it('returns PromptCopy with all fields', () => {
      const result = service.buildPromptCopy('zh-CN');

      expect(result).toHaveProperty('userIntro');
      expect(result).toHaveProperty('tone');
      expect(result).toHaveProperty('actionLabelHint');
      expect(result).toHaveProperty('factsLabel');
    });

    it('calls i18n.t for user_intro with languageLabel', () => {
      service.buildPromptCopy('zh-CN');
      expect(i18n.t).toHaveBeenCalledWith('test-scope.prompt.user_intro', {
        lang: 'zh-CN',
        args: { languageLabel: '中文' },
      });
    });

    it('calls i18n.t for English languageLabel', () => {
      service.buildPromptCopy('en');
      expect(i18n.t).toHaveBeenCalledWith('test-scope.prompt.user_intro', {
        lang: 'en',
        args: { languageLabel: 'English' },
      });
    });

    it('calls i18n.t for tone', () => {
      service.buildPromptCopy('en');
      expect(i18n.t).toHaveBeenCalledWith('test-scope.prompt.tone', {
        lang: 'en',
      });
    });

    it('calls i18n.t for facts_label', () => {
      service.buildPromptCopy('en');
      expect(i18n.t).toHaveBeenCalledWith('test-scope.prompt.facts_label', {
        lang: 'en',
      });
    });

    it('calls i18n.t for action_label (fallback)', () => {
      service.buildPromptCopy('en');
      expect(i18n.t).toHaveBeenCalledWith('test-scope.fallback.action_label', {
        lang: 'en',
      });
    });
  });

  describe('protected t method (via serviceUnavailable)', () => {
    it('passes args when provided', () => {
      // Create a subclass to test the protected t method with args
      class TestWithArgs extends LocalizedCopyService<PromptCopy> {
        protected readonly scope = 'args-scope';

        callT(
          locale: string,
          key: string,
          args?: Record<string, string | number>,
        ): string {
          return this.t(locale, key, args);
        }
      }

      const svc = new TestWithArgs(i18n);
      svc.callT('zh-CN', 'greeting', { name: 'World' });

      expect(i18n.t).toHaveBeenCalledWith('args-scope.greeting', {
        lang: 'zh-CN',
        args: { name: 'World' },
      });
    });
  });
});
