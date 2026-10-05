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
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  VERIFICATION_CODE_LENGTH,
} from './auth.decorators.js';

/** i18n namespace holding validation copy. */
export const VALIDATION_COPY_SCOPE = 'validation';

/**
 * Per-code interpolation values that the message itself cannot carry.
 *
 * A code like `validation.password.too_short` states the *rule*, not the bound
 * — the bound lives in the schema (`PASSWORD_MIN_LENGTH`). Keeping it here
 * means one place to update when a limit moves, instead of every call site
 * remembering to pass it.
 */
const CODE_LIMITS: Record<string, number> = {
  'validation.field.too_long': 20,
  'validation.password.too_short': PASSWORD_MIN_LENGTH,
  'validation.password.too_long': PASSWORD_MAX_LENGTH,
  'validation.code.invalid_length': VERIFICATION_CODE_LENGTH,
};

/**
 * Fallback English labels for a field path.
 *
 * **Only** a fallback: the primary source is `validation.field_label.<path>` in
 * the i18n dictionaries, because a single English table cannot serve Chinese
 * copy — an early version used this table directly and produced
 * "Verification code不能为空". Kept so an untranslated field still reads as a
 * label rather than a wire key.
 *
 * An unknown path falls back to the raw segment: a new field shows its key,
 * which is visible-but-not-cryptic and does not require editing two files to
 * ship.
 */
const FALLBACK_FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  password: 'Password',
  currentPassword: 'Current password',
  newPassword: 'New password',
  nickname: 'Nickname',
  code: 'Verification code',
  token: 'Token',
  scene: 'Scene',
  refreshToken: 'Refresh token',
  candidateId: 'Medicine id',
  dateFrom: 'Start date',
  dateTo: 'End date',
  callbackUri: 'Callback URI',
  identityToken: 'Identity token',
  authorizationCode: 'Authorization code',
  givenName: 'Given name',
  familyName: 'Family name',
};

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
  /**
   * Field path from the schema issue (e.g. `password`). Used to derive a
   * human-readable `{field}` label.
   */
  fieldPath?: string;
  /** Explicit field label; wins over `fieldPath` derivation. */
  field?: string;
  /**
   * Explicit numeric bound. Omitted values are looked up in `CODE_LIMITS`, so a
   * message never ships with a literal `{limit}` placeholder.
   */
  limit?: number;
}

/**
 * Renders a schema-authored message for the request language.
 *
 * Interpolation is **derived, not required**: `{field}` comes from the issue
 * path and `{limit}` from the code's registered bound. Relying on callers to
 * pass them shipped literal `{field}` text to users once already, which is
 * exactly the failure mode this function must not have.
 *
 * @param i18n    Translator (injected at the validation boundary).
 * @param locale  Resolved request language.
 * @param message Either a registered code or plain text.
 * @param context Optional overrides for the derived values.
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
  const field =
    context.field ??
    (context.fieldPath == null
      ? null
      : resolveFieldLabel(i18n, locale, context.fieldPath));
  if (field != null) args['field'] = field;

  const limit = context.limit ?? CODE_LIMITS[message];
  if (limit != null) args['limit'] = limit;

  const translated: string = i18n.t(
    `${VALIDATION_COPY_SCOPE}.${message.slice('validation.'.length)}`,
    { lang: locale, ...(Object.keys(args).length > 0 ? { args } : {}) },
  );

  // A missing key makes nestjs-i18n echo the key path; surface the code's tail
  // rather than an internal i18n path so a gap is visible but not cryptic.
  if (
    translated.includes(`.${VALIDATION_COPY_SCOPE}.`) ||
    translated.startsWith(`${VALIDATION_COPY_SCOPE}.`)
  ) {
    return message;
  }

  // Last line of defence: interpolate anything the dictionary left behind using
  // the values we derived, so a placeholder can never reach the client.
  return interpolate(translated, args);
}

/**
 * Resolves a localized label for a schema field path.
 *
 * Looks up `validation.field_label.<segment>` in the request language, falling
 * back to the English table and then to the raw segment. Only the last path
 * segment is used (`profile.email` → `email`), because that is the field the
 * user sees on the form.
 */
export function resolveFieldLabel(
  i18n: I18nService,
  locale: string,
  fieldPath: string,
): string {
  const last = fieldPath.split('.').filter(Boolean).pop() ?? fieldPath;
  const key = `${VALIDATION_COPY_SCOPE}.field_label.${last}`;
  const translated = i18n.t(key, { lang: locale });

  // nestjs-i18n echoes the key path on a miss.
  if (
    typeof translated === 'string' &&
    translated !== key &&
    !translated.startsWith(`${VALIDATION_COPY_SCOPE}.`)
  ) {
    return translated;
  }

  return FALLBACK_FIELD_LABELS[last] ?? last;
}

/**
 * English label for a field path.
 *
 * Read-only helper for callers that have no request language (none today); the
 * response path uses {@link resolveFieldLabel} so the label follows the request.
 */
export function fieldLabel(fieldPath: string): string {
  const last = fieldPath.split('.').filter(Boolean).pop() ?? fieldPath;
  return FALLBACK_FIELD_LABELS[last] ?? last;
}

/** Replaces `{name}` placeholders with `args`, leaving unknown ones intact. */
function interpolate(
  template: string,
  args: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/gu, (match, name: string) =>
    Object.hasOwn(args, name) ? String(args[name]) : match,
  );
}
