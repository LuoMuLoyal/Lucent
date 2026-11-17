/**
 * Field specs for the runtime-config document (`lucent-runtime-tuning.txt`).
 *
 * A field spec is the single declaration of one tunable key: which family it
 * belongs to, the value used when neither the environment nor the remote
 * document sets it (the current code constant), and how a raw `.env`-style
 * value is parsed into a typed value.
 *
 * Two rules shape the API:
 *
 * - **Parsing returns a result, never throws.** ADR-0012 keeps the codebase on
 *   a `Result` boundary for expected failures, and a rejected document must be
 *   reported to the operator with the offending key, not as a stack trace.
 * - **Error messages never echo the value.** The same messages reach logs, and
 *   the document may contain prompt text; a message like
 *   `AI_VISION_TEMPERATURE: must be an integer` is enough to act on.
 *
 * `environment.validation.ts` reuses these specs to reject a bad `.env` value at
 * startup, so bounds are declared exactly once.
 */

/**
 * Tunable families. Mirrors the family files in this directory; used for
 * grouping in logs/admin surfaces, not for validation.
 */
export type RuntimeConfigFamily =
  | 'ai'
  | 'retrieval'
  | 'meal'
  | 'queue'
  | 'cache'
  | 'auth'
  | 'storage'
  | 'app-info'
  | 'ops';

/** Outcome of parsing one raw remote value. */
export type FieldParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

/**
 * Value used when the key is absent from both the remote document and the
 * environment. A thunk is allowed for values that depend on another env key
 * (e.g. the log level defaults per `NODE_ENV`).
 */
export type RuntimeFieldDefault<T> = T | (() => T);

/** One tunable key. */
export interface RuntimeFieldSpec<T> {
  readonly family: RuntimeConfigFamily;
  readonly defaultValue: RuntimeFieldDefault<T>;
  /** Parses a trimmed, non-empty remote value. */
  readonly parse: (raw: string) => FieldParseResult<T>;
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_DAY = 86_400;

function ok<T>(value: T): FieldParseResult<T> {
  return { ok: true, value };
}

function fail<T>(message: string): FieldParseResult<T> {
  return { ok: false, message };
}

/** Resolves a spec's default, calling it when it is a thunk. */
export function resolveFieldDefault<T>(spec: RuntimeFieldSpec<T>): T {
  const value = spec.defaultValue;
  return typeof value === 'function' ? (value as () => T)() : value;
}

/** Validator shape shared by the string field builders. */
export type StringValueValidator = (value: string) => string | null;

/** Accepts only `http://` / `https://` URLs. */
export const httpUrlValidator: StringValueValidator = (value) =>
  /^https?:\/\/\S+$/u.test(value) ? null : 'must be an http or https URL';

/** Accepts a syntactically plausible e-mail address. */
export const emailValidator: StringValueValidator = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
    ? null
    : 'must be an e-mail address';

/** Field count of a cron expression (`m h dom mon dow`). */
const CRON_FIELD_COUNT = 5;

/** Accepts a five-field cron expression (`m h dom mon dow`). */
export const cronValidator: StringValueValidator = (value) =>
  value.split(/\s+/u).length === CRON_FIELD_COUNT
    ? null
    : 'must be a five-field cron expression';

interface StringFieldOptions {
  readonly family: RuntimeConfigFamily;
  readonly defaultValue: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly validate?: StringValueValidator;
}

function buildStringParser(
  options: StringFieldOptions,
): (raw: string) => FieldParseResult<string> {
  return (raw) => {
    if (options.minLength !== undefined && raw.length < options.minLength) {
      return fail(`must be at least ${String(options.minLength)} characters`);
    }
    if (options.maxLength !== undefined && raw.length > options.maxLength) {
      return fail(`must be at most ${String(options.maxLength)} characters`);
    }
    if (options.validate !== undefined) {
      const message = options.validate(raw);
      if (message !== null) {
        return fail(message);
      }
    }
    return ok(raw);
  };
}

/** A required string value. */
export function stringField(
  options: StringFieldOptions,
): RuntimeFieldSpec<string> {
  return {
    family: options.family,
    defaultValue: options.defaultValue,
    parse: buildStringParser(options),
  };
}

/**
 * A string that may be unset. `null` is the "not configured" value, matching
 * how the config services read optional env keys.
 */
export function nullableStringField(
  options: Omit<StringFieldOptions, 'defaultValue'> & {
    readonly defaultValue?: string | null;
  },
): RuntimeFieldSpec<string | null> {
  return {
    family: options.family,
    defaultValue: options.defaultValue ?? null,
    parse: buildStringParser({ ...options, defaultValue: '' }),
  };
}

interface NumberFieldOptions {
  readonly family: RuntimeConfigFamily;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  /** Set false for fractional values (sampling temperature). */
  readonly integer?: boolean;
}

function buildNumberParser(
  options: NumberFieldOptions,
): (raw: string) => FieldParseResult<number> {
  const integer = options.integer ?? true;
  return (raw) => {
    if (raw.trim() === '') {
      return fail('must be a number');
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      return fail('must be a number');
    }
    if (integer && !Number.isSafeInteger(value)) {
      return fail('must be an integer');
    }
    if (value < options.min || value > options.max) {
      return fail(
        `must be between ${String(options.min)} and ${String(options.max)}`,
      );
    }
    return ok(value);
  };
}

/** A required numeric value. */
export function numberField(
  options: NumberFieldOptions,
): RuntimeFieldSpec<number> {
  return {
    family: options.family,
    defaultValue: options.defaultValue,
    parse: buildNumberParser(options),
  };
}

/**
 * A numeric value that may be unset (`null`), used where the code currently
 * leaves the decision to the provider (per-role temperature/retries).
 */
export function nullableNumberField(
  options: Omit<NumberFieldOptions, 'defaultValue'> & {
    readonly defaultValue?: number | null;
  },
): RuntimeFieldSpec<number | null> {
  return {
    family: options.family,
    defaultValue: options.defaultValue ?? null,
    parse: buildNumberParser({ ...options, defaultValue: 0 }),
  };
}

/** A boolean that must be written as `true` or `false`. */
export function booleanField(options: {
  readonly family: RuntimeConfigFamily;
  readonly defaultValue: boolean;
}): RuntimeFieldSpec<boolean> {
  return {
    family: options.family,
    defaultValue: options.defaultValue,
    parse: (raw) => {
      if (raw === 'true') {
        return ok(true);
      }
      if (raw === 'false') {
        return ok(false);
      }
      return fail('must be true or false');
    },
  };
}

/** One of a fixed set of lowercase tokens. */
export function enumField<T extends string>(options: {
  readonly family: RuntimeConfigFamily;
  readonly values: readonly T[];
  readonly defaultValue: RuntimeFieldDefault<T>;
}): RuntimeFieldSpec<T> {
  return {
    family: options.family,
    defaultValue: options.defaultValue,
    parse: (raw) => {
      const match = options.values.find((candidate) => candidate === raw);
      return match === undefined
        ? fail(`must be one of: ${options.values.join(', ')}`)
        : ok(match);
    },
  };
}

/**
 * A comma-separated list, same syntax as `CORS_ORIGIN`. Empty elements are
 * rejected rather than dropped — `a,,b` is a typo, not a request for two
 * elements.
 */
export function csvField(options: {
  readonly family: RuntimeConfigFamily;
  readonly defaultValue: readonly string[];
}): RuntimeFieldSpec<string[]> {
  return {
    family: options.family,
    defaultValue: [...options.defaultValue],
    parse: (raw) => {
      const parts = raw.split(',').map((part) => part.trim());
      if (parts.some((part) => part.length === 0)) {
        return fail('must be a comma-separated list without empty elements');
      }
      return ok(parts);
    },
  };
}

/**
 * Parses a TTL written the way the JWT keys are (`15m`, `2h`, `14d`, or a bare
 * number of seconds). Mirrors `parseTtl` in `services/jwt.config.ts`, but
 * rejects what that helper silently defaults.
 */
export function parseDurationSeconds(raw: string): number | null {
  const match = /^(\d+)\s*(s|m|h|d)?$/iu.exec(raw);
  if (match === null) {
    return null;
  }
  const value = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1,
    m: SECONDS_PER_MINUTE,
    h: SECONDS_PER_HOUR,
    d: SECONDS_PER_DAY,
  };
  return value * (multipliers[unit] ?? 1);
}

/** A TTL with an explicit unit, exposed to consumers as seconds. */
export function durationSecondsField(options: {
  readonly family: RuntimeConfigFamily;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
}): RuntimeFieldSpec<number> {
  return {
    family: options.family,
    defaultValue: options.defaultValue,
    parse: (raw) => {
      const seconds = parseDurationSeconds(raw);
      if (seconds === null) {
        return fail('must be a duration such as 15m, 2h, 14d, or seconds');
      }
      if (seconds < options.min || seconds > options.max) {
        return fail(
          `must be between ${String(options.min)} and ${String(options.max)} seconds`,
        );
      }
      return ok(seconds);
    },
  };
}

/** A cron expression (five fields). */
export function cronField(options: {
  readonly family: RuntimeConfigFamily;
  readonly defaultValue: string;
}): RuntimeFieldSpec<string> {
  return {
    family: options.family,
    defaultValue: options.defaultValue,
    parse: (raw) => {
      const message = cronValidator(raw);
      return message === null ? ok(raw) : fail(message);
    },
  };
}

const MAX_PROMPT_LENGTH = 8_000;

/**
 * Expands the `\n` escapes an operator writes on one line into real newlines.
 * Only `\n` is an escape; every other backslash stays literal so URLs and
 * regex fragments are left alone.
 */
export function unescapePromptText(raw: string): string {
  return raw.replace(/\\n/gu, '\n');
}

/**
 * A prompt override. The value must keep every marker the code-side baseline
 * declares (`{{language}}`, `{{tools}}`, ...), otherwise the override would
 * drop data the caller cannot restore.
 */
export function promptField(options: {
  readonly family: RuntimeConfigFamily;
  readonly placeholders: readonly string[];
  readonly maxLength?: number;
}): RuntimeFieldSpec<string | null> {
  const maxLength = options.maxLength ?? MAX_PROMPT_LENGTH;
  return {
    family: options.family,
    defaultValue: null,
    parse: (raw) => {
      const text = unescapePromptText(raw);
      if (text.length > maxLength) {
        return fail(`must be at most ${String(maxLength)} characters`);
      }
      const missing = options.placeholders.filter(
        (name) => !text.includes(`{{${name}}}`),
      );
      if (missing.length > 0) {
        return fail(
          `must keep the placeholder(s): ${missing
            .map((name) => `{{${name}}}`)
            .join(', ')}`,
        );
      }
      return ok(text);
    },
  };
}
