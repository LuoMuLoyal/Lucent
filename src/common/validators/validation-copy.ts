/**
 * Stable validation message codes and their translation.
 *
 * Request schemas author a **stable code** (`validation.field.required`)
 * instead of a sentence, and this module renders it in the request's language
 * at the single boundary where validation issues become a response
 * (`StandardSchemaValidationPipe`'s `exceptionFactory`).
 *
 * Why codes rather than sentences in the schema:
 *
 * - A schema is built once at module load, so any prose baked into it is fixed
 *   at that moment — there is no request to read `Accept-Language` from. The
 *   former approach hardcoded Chinese, so an English user filling a form got
 *   `errors.issues[].message` in Chinese.
 * - The same code can be reused by several fields (`required` applies to any
 *   field), which keeps the dictionary small.
 *
 * `translateValidationMessage` treats anything that is *not* a registered code
 * as already-human-readable text and passes it through. That keeps third-party
 * schema messages (e.g. zod's own English defaults) working, and makes the
 * migration incremental.
 */

import type { I18nService } from 'nestjs-i18n';

/** i18n namespace holding validation copy. */
export const VALIDATION_COPY_SCOPE = 'validation';

/**
 * Registered message codes.
 *
 * Keep the list closed: `translateValidationMessage` only rewrites codes that
 * appear here, so a typo degrades to "pass the code through verbatim" rather
 * than silently dropping the message. `validation-copy.spec.ts` asserts every
 * code resolves in both locales.
 */
export const VALIDATION_MESSAGE_CODES = [
  'validation.field.required',
  'validation.field.too_long',
  'validation.field.invalid',
  'validation.password.too_short',
  'validation.password.too_long',
  'validation.password.too_weak',
  'validation.code.invalid_length',
  'validation.email.invalid',
  'validation.scene.invalid',
] as const;

export type ValidationMessageCode = (typeof VALIDATION_MESSAGE_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set(VALIDATION_MESSAGE_CODES);

export interface ValidationMessageContext {
  /** Field label to interpolate into the message, e.g. `密码`. */
  field?: string;
  /** Numeric bound (`min` / `max` / exact length). */
  limit?: number;
}

/**
 * Renders a schema-authored message for the request language.
 *
 * @param i18n    Translator (injected at the validation boundary).
 * @param locale  Resolved request language.
 * @param message Either a registered code or plain text.
 * @param context Interpolation values for the message.
 */
export function translateValidationMessage(
  i18n: I18nService,
  locale: string,
  message: string,
  context: ValidationMessageContext = {},
): string {
  if (!CODE_SET.has(message)) {
    // Not one of ours: zod's own English default, or already-final text.
    return message;
  }

  const args: Record<string, string | number> = {};
  if (context.field != null) args['field'] = context.field;
  if (context.limit != null) args['limit'] = context.limit;

  const translated: string = i18n.t(
    `${VALIDATION_COPY_SCOPE}.${message.slice('validation.'.length)}`,
    Object.keys(args).length > 0 ? { lang: locale, args } : { lang: locale },
  );

  // A missing key makes nestjs-i18n echo the key path; surface the code's tail
  // rather than an internal i18n path so a gap is visible but not cryptic.
  return translated.includes(`.${VALIDATION_COPY_SCOPE}.`) ||
    translated.startsWith(`${VALIDATION_COPY_SCOPE}.`)
    ? message
    : translated;
}
