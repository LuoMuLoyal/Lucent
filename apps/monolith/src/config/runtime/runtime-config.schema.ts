/**
 * Composition and parsing of the runtime-config document.
 *
 * The document is an `.env` subset — same `KEY=value` syntax, same key names —
 * so operators do not have to learn a second configuration language. It is not
 * a second configuration system: the environment stays the baseline, and the
 * only thing the document can do is override keys that take effect without a
 * restart.
 *
 * Parsing is strict by design: unknown keys, duplicate keys, out-of-range
 * values and a wrong schema version all reject the complete document. A partial
 * apply would leave the process running a mixture of two revisions, which is
 * exactly the state the snapshot/version model exists to prevent.
 *
 * Error messages identify the key but never echo the value: they reach logs,
 * and the document may hold prompt text.
 */

import { aiRuntimeFields } from './schema/ai.schema.js';
import { appInfoRuntimeFields } from './schema/app-info.schema.js';
import { authRuntimeFields } from './schema/auth.schema.js';
import { cacheRuntimeFields } from './schema/cache.schema.js';
import type { RuntimeFieldSpec } from './schema/field-spec.js';
import { mealRuntimeFields } from './schema/meal.schema.js';
import { opsRuntimeFields } from './schema/ops.schema.js';
import { queueRuntimeFields } from './schema/queue.schema.js';
import { retrievalRuntimeFields } from './schema/retrieval.schema.js';
import { storageRuntimeFields } from './schema/storage.schema.js';

/** Every tunable key, in one flat map: key -> family + baseline + parser. */
export const RUNTIME_CONFIG_FIELDS = {
  ...aiRuntimeFields,
  ...retrievalRuntimeFields,
  ...mealRuntimeFields,
  ...queueRuntimeFields,
  ...cacheRuntimeFields,
  ...authRuntimeFields,
  ...storageRuntimeFields,
  ...appInfoRuntimeFields,
  ...opsRuntimeFields,
} satisfies Record<string, RuntimeFieldSpec<unknown>>;

export type RuntimeConfigKey = keyof typeof RUNTIME_CONFIG_FIELDS;

type FieldValue<K extends RuntimeConfigKey> =
  (typeof RUNTIME_CONFIG_FIELDS)[K] extends RuntimeFieldSpec<infer T>
    ? T
    : never;

/** Resolved values of one snapshot (frozen before it is published). */
export type RuntimeConfigValues = {
  [K in RuntimeConfigKey]: FieldValue<K>;
};

export const RUNTIME_CONFIG_KEYS = Object.keys(
  RUNTIME_CONFIG_FIELDS,
) as RuntimeConfigKey[];

/** Document version this build understands. */
export const RUNTIME_CONFIG_SCHEMA_VERSION = 3;

/**
 * Reserved document keys: they describe the document, not the application, so
 * they are not in {@link RUNTIME_CONFIG_FIELDS} and are not read from `.env`.
 */
export const RUNTIME_CONFIG_SCHEMA_VERSION_KEY = 'RNACOS_SCHEMA_VERSION';
export const RUNTIME_CONFIG_REVISION_KEY = 'RNACOS_REVISION';

const RESERVED_DOCUMENT_KEYS = new Set<string>([
  RUNTIME_CONFIG_SCHEMA_VERSION_KEY,
  RUNTIME_CONFIG_REVISION_KEY,
]);

/** A document larger than this is an accident, not a configuration. */
export const RUNTIME_CONFIG_DOCUMENT_MAX_BYTES = 262_144;

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/u;
const REVISION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/u;

/** Why a document was rejected; the caller keeps using the previous snapshot. */
export type RuntimeConfigRejectionReason =
  | 'invalid_syntax'
  | 'invalid_schema'
  | 'unsupported_version'
  | 'duplicate_key';

export type RuntimeConfigDocumentParseResult =
  | {
      readonly ok: true;
      readonly overrides: Partial<RuntimeConfigValues>;
      readonly schemaVersion: number;
      readonly revision: string;
    }
  | {
      readonly ok: false;
      readonly reason: RuntimeConfigRejectionReason;
      readonly message: string;
    };

/** Rejection variant; narrower than the full result so `readRawLines` can reuse it. */
type RuntimeConfigDocumentRejection = Extract<
  RuntimeConfigDocumentParseResult,
  { ok: false }
>;

function reject(
  reason: RuntimeConfigRejectionReason,
  message: string,
): RuntimeConfigDocumentRejection {
  return { ok: false, reason, message };
}

/**
 * Splits the document into `key -> raw value` pairs. Comment-only and blank
 * lines are skipped; inline `#` is *not* a comment (URLs and prompts contain
 * one), so only a line whose first non-blank character is `#` is a comment.
 */
function readRawLines(
  raw: string,
):
  | { readonly ok: true; readonly entries: ReadonlyMap<string, string> }
  | RuntimeConfigDocumentRejection {
  const entries = new Map<string, string>();
  const lines = raw.split(/\r?\n/u);

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    const separator = line.indexOf('=');
    if (separator === -1) {
      return reject(
        'invalid_syntax',
        `line ${String(lineNumber)}: expected KEY=value`,
      );
    }

    const key = line.slice(0, separator).trim();
    if (!KEY_PATTERN.test(key)) {
      return reject(
        'invalid_syntax',
        `line ${String(lineNumber)}: key must match [A-Z][A-Z0-9_]*`,
      );
    }

    if (entries.has(key)) {
      return reject('duplicate_key', `key ${key} appears more than once`);
    }

    entries.set(key, line.slice(separator + 1).trim());
  }

  return { ok: true, entries };
}

/**
 * Parses and validates one document. Returns only the overrides — the caller
 * merges them onto the environment baseline, so a document that mentions a key
 * without a value keeps the baseline value rather than resetting it to zero.
 */
export function parseRuntimeConfigDocument(
  raw: string,
): RuntimeConfigDocumentParseResult {
  if (Buffer.byteLength(raw, 'utf8') > RUNTIME_CONFIG_DOCUMENT_MAX_BYTES) {
    return reject(
      'invalid_syntax',
      `document exceeds ${String(RUNTIME_CONFIG_DOCUMENT_MAX_BYTES)} bytes`,
    );
  }

  const parsedLines = readRawLines(raw);
  if (!parsedLines.ok) {
    return parsedLines;
  }
  const { entries } = parsedLines;

  const declaredVersion = entries.get(RUNTIME_CONFIG_SCHEMA_VERSION_KEY);
  if (declaredVersion === undefined) {
    return reject(
      'unsupported_version',
      `${RUNTIME_CONFIG_SCHEMA_VERSION_KEY} is required`,
    );
  }
  if (Number(declaredVersion) !== RUNTIME_CONFIG_SCHEMA_VERSION) {
    return reject(
      'unsupported_version',
      `${RUNTIME_CONFIG_SCHEMA_VERSION_KEY} must be ${String(RUNTIME_CONFIG_SCHEMA_VERSION)}`,
    );
  }

  const revision = entries.get(RUNTIME_CONFIG_REVISION_KEY) ?? '';
  if (!REVISION_PATTERN.test(revision)) {
    return reject(
      'invalid_schema',
      `${RUNTIME_CONFIG_REVISION_KEY} must be 1-64 characters of [A-Za-z0-9._-]`,
    );
  }

  const overrides: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (RESERVED_DOCUMENT_KEYS.has(key)) {
      continue;
    }
    const spec = (
      RUNTIME_CONFIG_FIELDS as Record<
        string,
        RuntimeFieldSpec<unknown> | undefined
      >
    )[key];
    if (spec === undefined) {
      return reject(
        'invalid_schema',
        `key ${key} is not a hot-tunable key and is not allowed in the runtime document`,
      );
    }
    // A blank value means "keep the baseline", not "set zero/empty".
    if (value === '') {
      continue;
    }
    const fieldResult = spec.parse(value);
    if (!fieldResult.ok) {
      return reject('invalid_schema', `key ${key}: ${fieldResult.message}`);
    }
    overrides[key] = fieldResult.value;
  }

  return {
    ok: true,
    overrides,
    schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
    revision,
  };
}

/** Freezes a resolved value map: values are shared with every reader. */
export function freezeRuntimeConfigValues(
  values: RuntimeConfigValues,
): Readonly<RuntimeConfigValues> {
  for (const key of RUNTIME_CONFIG_KEYS) {
    const value = values[key];
    if (Array.isArray(value)) {
      Object.freeze(value);
    }
  }
  return Object.freeze(values);
}
