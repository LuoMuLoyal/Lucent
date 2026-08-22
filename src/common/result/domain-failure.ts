import type { ProblemCode } from '../api/problem-catalog';

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
  readonly errors?: Readonly<Record<string, unknown>>;
  readonly retryable?: boolean;
  readonly retryAfter?: number;
  readonly cause?: unknown;
}

export interface CreateDomainFailureInput {
  kind: DomainFailureKind;
  code: DomainFailureCode;
  detail?: string;
  errors?: Readonly<Record<string, unknown>>;
  retryable?: boolean;
  retryAfter?: number;
  cause?: unknown;
}

export function createDomainFailure(
  input: CreateDomainFailureInput,
): DomainFailure {
  const candidate = { _tag: 'DomainFailure' as const, ...input };
  if (!isDomainFailure(candidate)) {
    throw new Error('Invalid DomainFailure input');
  }

  return Object.freeze({
    ...candidate,
    ...(candidate.errors == null ? {} : { errors: { ...candidate.errors } }),
  });
}

export function isDomainFailure(value: unknown): value is DomainFailure {
  if (!isRecord(value)) return false;
  if (value['_tag'] !== 'DomainFailure') return false;
  if (!isDomainFailureKind(value['kind'])) return false;
  if (
    typeof value['code'] !== 'string' ||
    value['code'].length === 0 ||
    value['code'].trim() !== value['code'] ||
    transportOnlyCodes.has(value['code'])
  ) {
    return false;
  }
  if (value['detail'] != null && typeof value['detail'] !== 'string') {
    return false;
  }
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

function isDomainFailureKind(value: unknown): value is DomainFailureKind {
  return (
    typeof value === 'string' &&
    (domainFailureKinds as readonly string[]).includes(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
