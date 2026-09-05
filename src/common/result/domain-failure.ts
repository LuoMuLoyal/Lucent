import type { ProblemCode } from '../api/problem-catalog.js';

const domainFailureKinds = [
  'validation',
  'authentication',
  'authorization',
  'not_found',
  'conflict',
  'rate_limited',
  'dependency',
  'internal',
] as const;

const transportOnlyCodes = new Set(['SERVER_SHUTDOWN', 'STREAM_CANCELLED']);

export type DomainFailureKind = (typeof domainFailureKinds)[number];

export type DomainFailureCode = Exclude<
  ProblemCode,
  'SERVER_SHUTDOWN' | 'STREAM_CANCELLED'
>;

export interface DomainFailure {
  readonly _tag: 'DomainFailure';
  readonly kind: DomainFailureKind;
  readonly code: DomainFailureCode;
  readonly detail?: string;
  readonly args?: Readonly<Record<string, string | number>>;
  readonly errors?: Readonly<Record<string, unknown>>;
  readonly retryable?: boolean;
  readonly retryAfter?: number;
  readonly cause?: unknown;
}

export interface CreateDomainFailureInput {
  kind: DomainFailureKind;
  code: DomainFailureCode;
  detail?: string;
  args?: Readonly<Record<string, string | number>>;
  errors?: Readonly<Record<string, unknown>>;
  retryable?: boolean;
  retryAfter?: number;
  cause?: unknown;
}

/**
 * Explicit mapping from every documented business ProblemCode to its
 * DomainFailureKind. Transport-only codes are intentionally excluded.
 *
 * This object is the single source of truth for kind/code consistency:
 * `createDomainFailure` rejects mismatched pairs so a code cannot accidentally
 * be emitted with the wrong semantic category.
 */
const DOMAIN_FAILURE_KIND_BY_CODE: Record<
  DomainFailureCode,
  DomainFailureKind
> = {
  AUTH_REQUIRED: 'authentication',
  AUTH_TOKEN_EXPIRED: 'authentication',
  AUTH_REFRESH_TOKEN_INVALID: 'authentication',
  AUTH_WRONG_PASSWORD: 'authentication',
  AUTH_PASSWORD_NOT_SET: 'authentication',
  AUTH_VERIFICATION_CODE_EXPIRED: 'authentication',
  AUTH_VERIFICATION_CODE_MISMATCH: 'authentication',
  AUTH_VERIFICATION_CODE_COOLDOWN: 'rate_limited',
  AUTH_VERIFICATION_CODE_RATE_LIMITED: 'rate_limited',
  AUTH_OAUTH_STATE_INVALID: 'authentication',
  AUTH_OAUTH_FAILED: 'authentication',
  AUTH_SESSION_NOT_FOUND: 'authentication',
  AUTH_SESSION_ACCESS_DENIED: 'authorization',
  AUTH_LOGIN_RATE_LIMITED: 'rate_limited',
  AUTH_METHOD_DISABLED: 'dependency',
  FORBIDDEN: 'authorization',
  VALIDATION_FAILED: 'validation',
  RESOURCE_NOT_FOUND: 'not_found',
  NOTIFICATION_NOT_FOUND: 'not_found',
  LEGAL_DOCUMENT_NOT_FOUND: 'not_found',
  SUGGESTION_NOT_FOUND: 'not_found',
  REPORT_SHARE_NOT_FOUND: 'not_found',
  RESOURCE_CONFLICT: 'conflict',
  RECORD_ALREADY_EXISTS: 'conflict',
  RATE_LIMITED: 'rate_limited',
  DEPENDENCY_UNAVAILABLE: 'dependency',
  DEPENDENCY_BAD_GATEWAY: 'dependency',
  DEPENDENCY_TIMEOUT: 'dependency',
  INTERNAL_ERROR: 'internal',
};

export function createDomainFailure(
  input: CreateDomainFailureInput,
): DomainFailure {
  const candidate = { _tag: 'DomainFailure' as const, ...input };
  if (!isDomainFailure(candidate)) {
    // eslint-disable-next-line error-handling/no-bare-throw-error -- invariant violation in pure helper, not a domain failure path
    throw new Error(`Invalid DomainFailure input: ${JSON.stringify(input)}`);
  }

  return Object.freeze({
    ...candidate,
    ...(candidate.errors == null ? {} : { errors: { ...candidate.errors } }),
    ...(candidate.args == null ? {} : { args: { ...candidate.args } }),
  });
}

export function isDomainFailure(value: unknown): value is DomainFailure {
  if (!isRecord(value)) return false;
  if (value['_tag'] !== 'DomainFailure') return false;
  if (!isDomainFailureKind(value['kind'])) return false;
  const code = value['code'];
  if (
    typeof code !== 'string' ||
    code.length === 0 ||
    code.trim() !== code ||
    transportOnlyCodes.has(code)
  ) {
    return false;
  }
  const kind = value['kind'];
  if (!isCodeKindConsistent(code, kind)) return false;
  if (value['detail'] != null && typeof value['detail'] !== 'string') {
    return false;
  }
  if (value['args'] != null && !isDomainFailureArgs(value['args']))
    return false;
  if (value['errors'] != null && !isRecord(value['errors'])) return false;
  if (value['retryable'] != null && typeof value['retryable'] !== 'boolean') {
    return false;
  }
  if (
    value['retryAfter'] != null &&
    (typeof value['retryAfter'] !== 'number' ||
      !Number.isFinite(value['retryAfter']) ||
      value['retryAfter'] < 0)
  ) {
    return false;
  }
  return true;
}

function isCodeKindConsistent(
  code: string,
  kind: DomainFailureKind,
): code is DomainFailureCode {
  return (
    Object.hasOwn(DOMAIN_FAILURE_KIND_BY_CODE, code) &&
    DOMAIN_FAILURE_KIND_BY_CODE[code as DomainFailureCode] === kind
  );
}

function isDomainFailureArgs(
  value: unknown,
): value is Record<string, string | number> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(
    (item) => typeof item === 'string' || typeof item === 'number',
  );
}

function isDomainFailureKind(value: unknown): value is DomainFailureKind {
  return (
    typeof value === 'string' &&
    (domainFailureKinds as readonly string[]).includes(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
