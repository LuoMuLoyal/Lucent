import type { I18nService } from 'nestjs-i18n';

/**
 * Action/evidence label resolution for suggestion cards.
 *
 * Shared by both read paths so they cannot drift again:
 *
 * - `SuggestionPresentationService.toDto` — the recompute/inline path, which
 *   builds a DTO straight from the in-memory candidate;
 * - `LifecycleService.getActiveSuggestions` — the read path, which rebuilds a
 *   DTO from the persisted row after the short-lived result cache expires.
 *
 * The read path used to skip this step entirely and pass the persisted
 * `primaryAction` through verbatim, so a cache miss surfaced the rule's raw
 * template key (`complete_profile`) as the button label while the same card
 * rendered a properly localized label whenever the cache happened to hit.
 */

/**
 * Whether an i18n result is a lookup miss rather than real copy.
 *
 * `nestjs-i18n` echoes the key path when nothing is registered; some
 * configurations append the resolved language (`key [en]`). Both shapes are
 * treated as a miss so a missing key never reaches the user as display text.
 */
export function isMissingTranslation(translated: string, key: string): boolean {
  const value = translated.trim();
  return value === key || value.startsWith(`${key} [`);
}

/** Returns the translation for an action key, or null when unregistered. */
export function translateActionKey(
  i18n: I18nService,
  label: string,
  locale: string,
): string | null {
  const key = `today-suggestion.action.${label}`;
  const translated: string = i18n.t(key, { lang: locale });
  return isMissingTranslation(translated, key) ? null : translated;
}

/**
 * Resolves an action label to display text.
 *
 * Translation order: the rule's own key, then the generated candidate if it
 * carries a real translation, then humanized fallbacks. Never returns a
 * snake_case key — an unregistered label used to be emitted verbatim, which is
 * what put a raw `complete_profile` on the suggestion card.
 */
export function resolveActionLabel(
  i18n: I18nService,
  label: string,
  locale: string,
  fallbackLabel?: string,
): string {
  const translated = translateActionKey(i18n, label, locale);
  if (translated != null) return translated;

  const candidate = fallbackLabel?.trim() ?? '';
  if (candidate.length > 0 && candidate !== label) {
    const fallbackTranslated = translateActionKey(i18n, candidate, locale);
    if (fallbackTranslated != null) return fallbackTranslated;
  }

  return humanizeActionLabel(candidate.length > 0 ? candidate : label);
}

export function localizeEvidenceLabel(
  i18n: I18nService,
  label: string,
  locale: string,
): string {
  return i18n.t(`today-suggestion.evidence.${label}`, { lang: locale });
}

export function localizeEvidenceValue(
  i18n: I18nService,
  value: string,
  locale: string,
  args?: Record<string, string | number>,
): string {
  const key = `today-suggestion.evidence_value.${value}`;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- tsc infers unknown (variable assignment loses generic inference), ESLint infers string
  const translated = i18n.t(
    key,
    args != null ? { lang: locale, args } : { lang: locale },
  ) as string;
  // When i18n can't find the key, it returns the key path itself — fall back to raw value
  return translated === key ? value : translated;
}

/**
 * Last-resort display text for an action label with no translation.
 *
 * Turns a snake_case identifier (`complete_profile`) or a camelCase one
 * (`completeProfile`) into `Complete profile`, so an unregistered key degrades
 * to readable text instead of exposing an internal identifier to the user.
 */
export function humanizeActionLabel(label: string): string {
  const spaced = label
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (spaced.length === 0) return label;

  const lowered = spaced.toLowerCase();
  return lowered.charAt(0).toUpperCase() + lowered.slice(1);
}
