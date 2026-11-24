/**
 * Locale defaults for the Today suggestion engine.
 *
 * `SUGGESTION_DEFAULT_LOCALE` is the language used when the user has stored no
 * preference. The client uploads an empty string for "follow the system
 * language", so the absence of a preference is a normal state, not an error —
 * it resolves to the product's primary language rather than `resolveLocale`'s
 * `en` fallback.
 */
export const SUGGESTION_DEFAULT_LOCALE = 'zh-CN';
