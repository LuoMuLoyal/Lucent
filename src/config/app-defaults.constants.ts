/**
 * Shared configuration constants used by both validation schemas and runtime
 * config factories. Keeping defaults and limits here avoids magic numbers in
 * Joi schemas and `registerAs()` callbacks drifting apart.
 */

// ── Tencent COS presigned URLs ───────────────────────────────────────────────

/** Default expiry for presigned COS upload/download URLs (10 minutes). */
export const DEFAULT_COS_UPLOAD_EXPIRY_SECONDS = 600;

/** Maximum allowed expiry for presigned COS upload/download URLs (1 hour). */
export const MAX_COS_UPLOAD_EXPIRY_SECONDS = 3600;

/** Default maximum upload size for COS (10 MiB). */
export const DEFAULT_COS_MAX_UPLOAD_BYTES = 10_485_760;

/** Maximum allowed upload size for COS (≈ 50 MiB). */
export const MAX_COS_MAX_UPLOAD_BYTES = 50_000_000;

// ── AI / embeddings ──────────────────────────────────────────────────────────

/** Default embedding dimension (OpenAI text-embedding-3-small). */
export const DEFAULT_EMBEDDING_DIMENSION = 1536;

/** Maximum embedding dimension accepted by the environment validator. */
export const MAX_EMBEDDING_DIMENSION = 4096;

/**
 * Timeout (ms) for AI model invocations (structured output, streaming, chat).
 * Centralised here so all AI call sites share a single source of truth.
 */
export const AI_MODEL_TIMEOUT_MS = 10_000;

// ── JWT ───────────────────────────────────────────────────────────────────────

/** Default access-token TTL in seconds (2 hours). */
export const DEFAULT_JWT_ACCESS_TTL_SECONDS = 2 * 3600;

/** Default refresh-token TTL in seconds (30 days). */
export const DEFAULT_JWT_REFRESH_TTL_SECONDS = 30 * 86400;

// ── Verification code ──────────────────────────────────────────────────────────

/** Default verification-code TTL in milliseconds (5 minutes). */
export const DEFAULT_VERIFICATION_CODE_TTL_MS = 5 * 60 * 1000;

/** Default cooldown between verification-code sends (60 seconds). */
export const DEFAULT_VERIFICATION_COOLDOWN_MS = 60 * 1000;

/** Default rate-limit window for verification-code requests (10 minutes). */
export const DEFAULT_VERIFICATION_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/** Default max verification-code requests per rate-limit window. */
export const DEFAULT_VERIFICATION_RATE_LIMIT_MAX = 20;

/** Default verification-code length (digits). */
export const DEFAULT_VERIFICATION_CODE_LENGTH = 6;

// ── OAuth state ────────────────────────────────────────────────────────────────

/** Default OAuth state TTL in milliseconds (10 minutes). */
export const DEFAULT_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

// ── Mail queue ─────────────────────────────────────────────────────────────────

/** Default maximum send attempts per mail job. */
export const DEFAULT_MAIL_QUEUE_MAX_ATTEMPTS = 3;

/** Default initial backoff delay in ms for exponential mail retry. */
export const DEFAULT_MAIL_QUEUE_BACKOFF_DELAY_MS = 5_000;

/** Default worker concurrency for the mail queue. */
export const DEFAULT_MAIL_QUEUE_WORKER_CONCURRENCY = 3;

/** Default age (seconds) after which completed mail jobs are removed (24 h). */
export const DEFAULT_MAIL_QUEUE_COMPLETE_AGE_SECONDS = 24 * 60 * 60;

/** Default age (seconds) after which failed mail jobs are removed (7 d). */
export const DEFAULT_MAIL_QUEUE_FAIL_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Default maximum number of completed mail jobs to retain. */
export const DEFAULT_MAIL_QUEUE_COMPLETE_MAX_COUNT = 1_000;

/** Default maximum number of failed mail jobs to retain. */
export const DEFAULT_MAIL_QUEUE_FAIL_MAX_COUNT = 5_000;

// ── LLM call retry ──────────────────────────────────────────────────────────

/** Default maximum retry attempts for LLM invocations (excluding the first call). */
export const LLM_RETRY_ATTEMPTS = 2;

/** Base delay (ms) for exponential backoff between LLM retry attempts. */
export const LLM_RETRY_BASE_DELAY_MS = 800;

// ── Observability ─────────────────────────────────────────────────────────────

/** Default threshold (ms) above which a request is logged as slow. */
export const DEFAULT_SLOW_REQUEST_THRESHOLD_MS = 2_000;

/** Default threshold (ms) above which a Prisma query is logged as slow. */
export const DEFAULT_SLOW_QUERY_THRESHOLD_MS = 500;
