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
