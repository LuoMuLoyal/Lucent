import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

type Dict = Record<string, unknown>;

/**
 * Minimal `I18nService` stand-in backed by the shipped JSON dictionaries.
 *
 * Tests that construct a real service (rather than mocking it) need copy that
 * actually resolves — using the real files means a key that only exists in one
 * locale fails the suite instead of rendering a placeholder in production.
 *
 * Lives under `src/` (not a spec file) because several modules' specs need it.
 * It is only reachable from tests: nothing in production imports this path.
 *
 * Key resolution mirrors `nestjs-i18n` closely enough for these suites: the
 * first segment is the file/namespace, and the remainder is looked up as a
 * nested path, falling back to a flat key (the assistant dictionary uses dotted
 * flat keys such as `preview.kind`).
 */
export function makeTestI18n(defaultLocale = 'en') {
  const cache = new Map<string, Dict>();

  const load = (locale: string, scope: string): Dict | null => {
    const cacheKey = `${locale}/${scope}`;
    const cached = cache.get(cacheKey);
    if (cached != null) return cached;
    // thisDir = src/common/tests → two levels up to src/.
    const file = path.join(
      thisDir,
      '..',
      '..',
      'i18n',
      locale,
      `${scope}.json`,
    );
    // Presence check instead of try/catch: an unknown namespace is an expected
    // miss here (the caller falls back to echoing the key), and a catch block
    // would have to either log or suppress for the lint rule.
    if (!existsSync(file)) return null;
    const dict = JSON.parse(readFileSync(file, 'utf8')) as Dict;
    cache.set(cacheKey, dict);
    return dict;
  };

  const resolve = (dict: Dict, key: string): string | null => {
    // Flat key wins when present, so dotted keys keep working.
    const flat = dict[key];
    if (typeof flat === 'string') return flat;

    let node: unknown = dict;
    for (const segment of key.split('.')) {
      if (node == null || typeof node !== 'object') return null;
      node = (node as Dict)[segment];
    }
    return typeof node === 'string' ? node : null;
  };

  return {
    t(
      key: string,
      options?: { lang?: string; args?: Record<string, string | number> },
    ): string {
      const [scope, ...rest] = key.split('.');
      const subKey = rest.join('.');
      const locale = options?.lang ?? defaultLocale;
      const dict = load(locale, scope ?? '');
      // Unknown namespace: behave like nestjs-i18n and echo the key.
      if (dict == null) return key;
      const template = resolve(dict, subKey);
      if (template == null) return key;
      if (options?.args == null) return template;
      const args = options.args;
      return template.replace(/\{(\w+)\}/gu, (match, name: string) =>
        name in args ? String(args[name]) : match,
      );
    },
  };
}
