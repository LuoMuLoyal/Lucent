import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_PRESENTER_COPY_KEYS,
  createAssistantTranslator,
} from './copy.js';
import { makeTestI18n } from '../../../../common/tests/test-i18n.js';

describe('assistant copy', () => {
  const LOCALES = ['zh-CN', 'en'] as const;

  it.each(LOCALES)('resolves every presenter key in %s', (locale) => {
    const t = createAssistantTranslator(makeTestI18n(), locale);

    for (const key of ASSISTANT_PRESENTER_COPY_KEYS) {
      // A missing key would render as [[assistant.<key>]] for the user.
      expect(t(key), `missing assistant i18n key: ${key}`).not.toMatch(
        /^\[\[/u,
      );
      expect(t(key).length).toBeGreaterThan(0);
    }
  });

  it('keeps zh-CN and en key sets in step', () => {
    // A key present in only one locale falls back to English at runtime, which
    // is silent. Comparing the dictionaries makes the drift loud.
    const missing = ASSISTANT_PRESENTER_COPY_KEYS.filter((key) => {
      const zh = createAssistantTranslator(makeTestI18n(), 'zh-CN')(key);
      const en = createAssistantTranslator(makeTestI18n(), 'en')(key);
      return zh.startsWith('[[') || en.startsWith('[[');
    });

    expect(missing).toEqual([]);
  });

  it('interpolates args instead of leaving the placeholder', () => {
    const t = createAssistantTranslator(makeTestI18n(), 'en');

    const summary = t('proposal.summary.delete_record', {
      kind: 'water',
      occurredAt: '2026-07-11',
    });

    expect(summary).toContain('water');
    expect(summary).toContain('2026-07-11');
    expect(summary).not.toContain('{');
  });

  it('marks a missing key visibly instead of printing the bare key', () => {
    const t = createAssistantTranslator(makeTestI18n(), 'en');

    expect(t('does.not.exist')).toBe('[[assistant.does.not.exist]]');
  });
});
