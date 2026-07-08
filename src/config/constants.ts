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

// ── Meal analysis ─────────────────────────────────────────────────────────────

/** Default portion size in grams when portion text is unspecified. */
export const DEFAULT_MEAL_PORTION_GRAMS = 100;

/** Small portion size in grams (e.g. "少量"). */
export const DEFAULT_MEAL_SMALL_PORTION_GRAMS = 30;

/** Threshold (g) above which a meal is considered high-protein. */
export const DEFAULT_MEAL_HIGH_PROTEIN_THRESHOLD_G = 20;

/** Threshold (g) below which a meal is considered low-carbohydrate. */
export const DEFAULT_MEAL_LOW_CARBOHYDRATE_THRESHOLD_G = 20;

/** Threshold (g) above which a meal is considered high-fat. */
export const DEFAULT_MEAL_HIGH_FAT_THRESHOLD_G = 20;
