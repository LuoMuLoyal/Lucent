/**
 * Helpers for overlaying runtime-config values onto storage settings.
 *
 * The storage family publishes bucket, region, public base URL, signing
 * expiry and upload limit; credentials and endpoints remain environment-only.
 * A published empty string means "not configured here", so it falls back to the
 * environment baseline instead of blanking the value.
 */

export function pickString(published: unknown, fallback: string): string {
  if (typeof published !== 'string') {
    return fallback;
  }
  const trimmed = published.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function pickNumber(published: unknown, fallback: number): number {
  return typeof published === 'number' ? published : fallback;
}
