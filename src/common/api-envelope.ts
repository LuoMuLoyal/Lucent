/**
 * API result codes.
 *
 * `0` = success. Non-zero = failure, pattern: `<http-status-prefix><sequence>`.
 *
 * - `0`                          → success
 * - `400xxx`                     → client / validation errors
 * - `401xxx`                     → authentication errors
 * - `403xxx`                     → authorization errors
 * - `404xxx`                     → resource not found
 * - `409xxx`                     → business conflicts
 * - `500xxx`                     → server / infrastructure errors
 */
export enum ResultCode {
  // ── Success ──────────────────────────────────────────────────
  /** Request succeeded */
  SUCCESS = 0,

  // ── Client errors (400xxx) ───────────────────────────────────
  /** Missing or malformed request parameters */
  BAD_REQUEST = 400_001,
  /** DTO validation failed (field-level details in message) */
  VALIDATION_FAILED = 400_002,

  // ── Auth errors (401xxx) ─────────────────────────────────────
  /** Not authenticated (no token / invalid signature) */
  UNAUTHORIZED = 401_001,
  /** Access token expired, needs refresh */
  TOKEN_EXPIRED = 401_002,
  /** Refresh token invalid or expired */
  REFRESH_TOKEN_INVALID = 401_003,

  // ── Forbidden (403xxx) ───────────────────────────────────────
  /** Authenticated but lacking required permission */
  FORBIDDEN = 403_001,

  // ── Not found (404xxx) ───────────────────────────────────────
  /** Requested resource does not exist */
  NOT_FOUND = 404_001,

  // ── Conflict (409xxx) ────────────────────────────────────────
  /** Resource already exists (e.g. duplicate add) */
  CONFLICT = 409_001,

  // ── Server errors (500xxx) ───────────────────────────────────
  /** Unclassified internal error */
  INTERNAL_ERROR = 500_001,
  /** Database operation failed */
  DATABASE_ERROR = 500_002,
  /** Third-party service timeout or failure */
  EXTERNAL_SERVICE_ERROR = 500_003,
}

export interface ApiEnvelope<T = unknown> {
  code: ResultCode;
  message: string;
  data: T | null;
  meta?: Record<string, unknown>;
}

export function successEnvelope<T>(data: T): ApiEnvelope<T> {
  return {
    code: ResultCode.SUCCESS,
    message: '',
    data,
  };
}

export function errorEnvelope(
  code: ResultCode,
  message: string,
): ApiEnvelope<never> {
  return {
    code,
    message,
    data: null,
  };
}
