/**
 * Shared string utilities.
 */

/** Trims whitespace and returns null if the value is not a non-empty string. */
export function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Counts the number of characters that appear in both strings, without
 * double-counting repeated characters.
 */
export function commonCharacterCount(left: string, right: string): number {
  const leftCounts = new Map<string, number>();
  for (const char of left) {
    leftCounts.set(char, (leftCounts.get(char) ?? 0) + 1);
  }

  let common = 0;
  for (const char of right) {
    const count = leftCounts.get(char);
    if (count != null && count > 0) {
      common += 1;
      leftCounts.set(char, count - 1);
    }
  }

  return common;
}
