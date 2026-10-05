import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { I18nService } from 'nestjs-i18n';
import {
  VALIDATION_COPY_SCOPE,
  VALIDATION_MESSAGE_CODES,
  translateValidationMessage,
} from './validation-copy.js';
import { makeTestI18n } from '../tests/test-i18n.js';

/** Minimal translator that records the key + options it was asked for. */
function recordingI18n(returnValue: string) {
  const calls: Array<{ key: string; options?: Record<string, unknown> }> = [];
  return {
    calls,
    i18n: {
      t(key: string, options?: Record<string, unknown>) {
        calls.push({ key, ...(options == null ? {} : { options }) });
        return returnValue;
      },
    } as unknown as I18nService,
  };
}

describe('translateValidationMessage', () => {
  it('translates a registered code through the validation namespace', () => {
    const { calls, i18n } = recordingI18n('Password is too short');

    const out = translateValidationMessage(
      i18n,
      'en',
      'validation.password.too_short',
    );

    expect(out).toBe('Password is too short');
    expect(calls[0]?.key).toBe(`${VALIDATION_COPY_SCOPE}.password.too_short`);
    expect(calls[0]?.options?.['lang']).toBe('en');
  });

  it('passes through text that is not a registered code', () => {
    // zod's own English defaults, and any third-party message, must survive:
    // otherwise the migration would silently blank messages it doesn't own.
    const { calls, i18n } = recordingI18n('translated');

    expect(translateValidationMessage(i18n, 'en', 'Invalid input')).toBe(
      'Invalid input',
    );
    expect(calls).toHaveLength(0);
  });

  it('forwards interpolation args only when present', () => {
    const { calls, i18n } = recordingI18n('x');

    translateValidationMessage(i18n, 'en', 'validation.field.too_long', {
      field: 'Nickname',
      limit: 20,
    });
    expect(calls[0]?.options?.['args']).toEqual({
      field: 'Nickname',
      limit: 20,
    });

    calls.length = 0;
    translateValidationMessage(i18n, 'en', 'validation.field.required');
    expect(calls[0]?.options?.['args']).toBeUndefined();
  });

  it('falls back to the code when the dictionary has no entry', () => {
    // nestjs-i18n echoes the key path on a miss; surfacing that would leak an
    // internal i18n path to the client.
    const { i18n } = recordingI18n(
      `${VALIDATION_COPY_SCOPE}.password.too_short`,
    );

    expect(
      translateValidationMessage(i18n, 'en', 'validation.password.too_short'),
    ).toBe('validation.password.too_short');
  });

  it.each(['zh-CN', 'en'] as const)(
    'resolves every registered code in %s',
    (locale) => {
      const i18n = makeTestI18n() as unknown as I18nService;
      const missing = VALIDATION_MESSAGE_CODES.filter((code) => {
        const out = translateValidationMessage(i18n, locale, code);
        // A miss returns the code itself (or an echoed key path).
        return out === code || out.includes(VALIDATION_COPY_SCOPE);
      });

      expect(missing).toEqual([]);
    },
  );

  it('keeps the zh-CN and en dictionaries in step', () => {
    const read = (locale: string): Record<string, unknown> =>
      JSON.parse(
        readFileSync(
          path.join('src', 'i18n', locale, `${VALIDATION_COPY_SCOPE}.json`),
          'utf8',
        ),
      ) as Record<string, unknown>;

    const flatten = (node: unknown, prefix = ''): string[] => {
      if (node == null || typeof node !== 'object') return [prefix];
      return Object.entries(node as Record<string, unknown>).flatMap(
        ([key, value]) =>
          flatten(value, prefix === '' ? key : `${prefix}.${key}`),
      );
    };

    expect(flatten(read('zh-CN')).sort()).toEqual(flatten(read('en')).sort());
  });
});
