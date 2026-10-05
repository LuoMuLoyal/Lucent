/**
 * Binds the `data-export` copy namespace for one locale.
 *
 * The PDF renderers are pure functions spread across several modules
 * (`pdf.service`, `draw.service`, `report-pdf.theme`), so instead of each
 * taking an `I18nService` they take this bound translator — the same shape the
 * mail templates and assistant presenters use.
 *
 * Why the copy moved out of the renderers at all: they previously held
 * `isZh ? '中文' : 'English'` ternaries inline. That is a boolean, not a
 * locale, so a third language could not be added without editing every call
 * site, and the strings were invisible to the i18n tooling.
 */
export const DATA_EXPORT_COPY_SCOPE = 'data-export';

/** Translator bound to one locale. */
export type PdfTranslator = (
  key: string,
  args?: Record<string, string | number>,
) => string;

/**
 * The slice of `I18nService` needed here.
 *
 * Structural rather than `Pick<I18nService, 't'>`: the real service's generic
 * overloads make a plain test double unassignable.
 */
export interface PdfI18nPort {
  t(
    key: string,
    options?: { lang?: string; args?: Record<string, string | number> },
  ): string;
}

/**
 * A missing key becomes `[[data-export.<key>]]`.
 *
 * `nestjs-i18n` echoes the key path on a miss; a PDF is a user-facing artifact
 * that cannot be re-rendered for review, so an unmistakable marker is better
 * than silently printing `data-export.footer_note`.
 */
export function createPdfTranslator(
  i18n: PdfI18nPort,
  locale: string,
): PdfTranslator {
  return (key, args) => {
    const fullKey = `${DATA_EXPORT_COPY_SCOPE}.${key}`;
    const translated = i18n.t(fullKey, {
      lang: locale,
      ...(args == null ? {} : { args }),
    });
    return typeof translated === 'string' && translated !== fullKey
      ? translated
      : `[[${fullKey}]]`;
  };
}
