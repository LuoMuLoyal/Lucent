/**
 * Valid legal document type path segments.
 *
 * These match the hyphenated form used in the Flutter app's route paths
 * (e.g. `minor-protection`, `sdk-list`).
 */
export const LEGAL_DOC_TYPES = [
  'terms',
  'privacy',
  'disclaimer',
  'minor-protection',
  'sdk-list',
  'permissions',
  'account-cancellation',
] as const;

export type LegalDocType = (typeof LEGAL_DOC_TYPES)[number];

/** Supported content languages. */
export const LEGAL_LANGS = ['zh', 'en'] as const;
export type LegalLang = (typeof LEGAL_LANGS)[number];

export const DEFAULT_LEGAL_LANG: LegalLang = 'zh';
