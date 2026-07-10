import type { I18nService } from 'nestjs-i18n';
import {
  resolveLocale,
  buildLocalizedPromptCopy,
  buildUserPrompt,
  translateScopedCopy,
} from './localized-copy';

describe('localized-copy', () => {
  let i18n: jest.Mocked<I18nService>;

  beforeEach(() => {
    i18n = {
      t: jest.fn((key: string, opts?: Record<string, unknown>) => {
        if (opts && 'args' in opts) {
          const args = opts.args as Record<string, string>;
          return Object.entries(args).reduce(
            (str, [k, v]) => str.replace(`{${k}}`, v),
            key,
          );
        }
        return key;
      }),
    } as unknown as jest.Mocked<I18nService>;
  });

  describe('resolveLocale', () => {
    it('returns zh-CN for zh prefixed strings', () => {
      expect(resolveLocale('zh')).toBe('zh-CN');
      expect(resolveLocale('zh-CN')).toBe('zh-CN');
      expect(resolveLocale('zh-TW')).toBe('zh-CN');
    });

    it('returns en for non-zh strings', () => {
      expect(resolveLocale('en')).toBe('en');
      expect(resolveLocale('en-US')).toBe('en');
      expect(resolveLocale('fr')).toBe('en');
    });

    it('returns en for undefined', () => {
      expect(resolveLocale(undefined)).toBe('en');
    });

    it('returns en for empty string', () => {
      expect(resolveLocale('')).toBe('en');
    });

    it('returns en for whitespace-only string', () => {
      expect(resolveLocale('   ')).toBe('en');
    });
  });

  describe('translateScopedCopy', () => {
    it('calls i18n.t with scoped key and locale', () => {
      translateScopedCopy(i18n, 'my-scope', 'zh-CN', 'greeting');
      expect(i18n.t).toHaveBeenCalledWith('my-scope.greeting', {
        lang: 'zh-CN',
      });
    });

    it('passes args when provided', () => {
      translateScopedCopy(i18n, 'my-scope', 'en', 'greeting', {
        name: 'World',
      });
      expect(i18n.t).toHaveBeenCalledWith('my-scope.greeting', {
        lang: 'en',
        args: { name: 'World' },
      });
    });

    it('returns the translation result', () => {
      const result = translateScopedCopy(i18n, 'scope', 'en', 'key');
      expect(result).toBe('scope.key');
    });
  });

  describe('buildLocalizedPromptCopy', () => {
    it('returns PromptCopy with all required fields', () => {
      const result = buildLocalizedPromptCopy(i18n, 'scope', 'zh-CN');
      expect(result).toHaveProperty('userIntro');
      expect(result).toHaveProperty('tone');
      expect(result).toHaveProperty('actionLabelHint');
      expect(result).toHaveProperty('factsLabel');
    });

    it('includes languageLabel in userIntro for zh-CN', () => {
      buildLocalizedPromptCopy(i18n, 'scope', 'zh-CN');
      expect(i18n.t).toHaveBeenCalledWith('scope.prompt.user_intro', {
        lang: 'zh-CN',
        args: { languageLabel: '中文' },
      });
    });

    it('includes languageLabel in userIntro for en', () => {
      buildLocalizedPromptCopy(i18n, 'scope', 'en');
      expect(i18n.t).toHaveBeenCalledWith('scope.prompt.user_intro', {
        lang: 'en',
        args: { languageLabel: 'English' },
      });
    });
  });

  describe('buildUserPrompt', () => {
    it('joins copy fields and JSON context with newlines', () => {
      const copy = {
        userIntro: 'Hello',
        tone: 'friendly',
        actionLabelHint: 'Use action',
        factsLabel: 'Facts:',
      };
      const context = { key: 'value' };
      const result = buildUserPrompt(context, copy);
      expect(result).toContain('Hello');
      expect(result).toContain('friendly');
      expect(result).toContain('Use action');
      expect(result).toContain('Facts:');
      expect(result).toContain(JSON.stringify(context));
      expect(result.split('\n')).toHaveLength(5);
    });
  });
});
