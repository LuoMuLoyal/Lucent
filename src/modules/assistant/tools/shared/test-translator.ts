import { makeTestI18n } from '../../../../common/tests/test-i18n.js';
import { createAssistantTranslator } from './copy.js';

/**
 * Test-only translator over the real `src/i18n/{zh-CN,en}/assistant.json`.
 *
 * Thin wrapper over {@link makeTestI18n} so presenter specs exercise the same
 * lookup path production uses while still resolving the shipped dictionary: a
 * key that exists in one locale only fails the suite rather than rendering a
 * placeholder at runtime.
 */
export function createTestTranslator(
  locale: 'zh-CN' | 'en',
): (key: string, args?: Record<string, string | number>) => string {
  return createAssistantTranslator(makeTestI18n(), locale);
}
