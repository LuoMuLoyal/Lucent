import { resolveLocale } from '../../../../common/index.js';

/**
 * Binds the `reports-clinic-summary` namespace (PDF subtree) for one locale.
 *
 * The clinic-summary PDF renderers previously took an `isZh: boolean` and held
 * `isZh ? '中文' : 'English'` ternaries inline — a boolean cannot express a
 * third language, and the strings were invisible to the i18n tooling.
 *
 * The namespace already existed for the share/disclaimer copy, so the PDF copy
 * joins it rather than starting a parallel dictionary.
 */
export type ClinicSummaryTranslator = (
  key: string,
  args?: Record<string, string | number>,
) => string;

/** The slice of `I18nService` needed here (structural, for test doubles). */
export interface ClinicSummaryI18nPort {
  t(
    key: string,
    options?: { lang?: string; args?: Record<string, string | number> },
  ): string;
}

/**
 * A missing key becomes `[[reports-clinic-summary.pdf.…]]`.
 *
 * `nestjs-i18n` echoes the key path on a miss, and a PDF is a user-facing
 * artifact that cannot be re-rendered for review — an unmistakable marker beats
 * silently printing an internal key to a doctor.
 */
export function createClinicSummaryPdfTranslator(
  i18n: ClinicSummaryI18nPort,
  locale: string,
): ClinicSummaryTranslator {
  const lang = resolveLocale(locale);
  return (key, args) => {
    const fullKey = `reports-clinic-summary.pdf.${key}`;
    const translated = i18n.t(fullKey, {
      lang,
      ...(args == null ? {} : { args }),
    });
    return typeof translated === 'string' && translated !== fullKey
      ? translated
      : `[[${fullKey}]]`;
  };
}
