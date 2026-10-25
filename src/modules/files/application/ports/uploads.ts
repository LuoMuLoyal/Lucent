/**
 * Upload use-case contracts (`application/ports`).
 *
 * These types used to be inferred only from the zod schemas in
 * `adapters/http/dto/`, which forced the use case to import its own delivery
 * adapter just to name its input. The dependency now points the useful way: the
 * schemas are pinned to these types with `satisfies`, so a wire change that drops
 * or renames a field fails to compile there instead of silently narrowing what
 * the use case receives.
 *
 * Types only — no zod here.
 */

/** Request body of \`POST /files/upload\`. */
export interface CreateFileUploadRequest {
  /** MIME type the client intends to upload. */
  contentType: string;
  /** Size in bytes, used against the configured per-file cap. */
  sizeBytes: number;
  /** Original filename (used only for the extension of the object key). */
  fileName?: string;
}

/**
 * Presigned-upload payload returned to the client.
 *
 * Every key is always present: `publicUrl` is `null` when the active storage
 * provider has no public base URL configured, and clients render nothing in that
 * case rather than parsing the raw body.
 */
export interface PresignedUpload {
  provider: string;
  bucket: string;
  objectKey: string;
  /** Signed PUT URL for the direct object-storage upload. */
  uploadUrl: string;
  /** Headers that must accompany the PUT. */
  headers: Record<string, string>;
  /** Public/CDN URL when one is configured, else `null`. */
  publicUrl: string | null;
  /** Signed-URL expiry (ISO 8601). */
  expiresAt: string;
  /** Maximum accepted upload size, echoed from the runtime configuration. */
  maxSizeBytes: number;
}
