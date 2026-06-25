/**
 * Shared string utilities.
 */

/** Trims whitespace and returns null if the result is empty. */
export function normalizeNullableText(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
