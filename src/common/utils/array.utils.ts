/**
 * Shared array utilities.
 */

/** Fisher-Yates shuffle — uniform random permutation. */
export function shuffleArray<T>(array: readonly T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = result[i];
    result[i] = result[j] as T;
    result[j] = temp as T;
  }
  return result;
}

/** Returns true when the value is null, undefined, or an empty array. */
export function isEmptyArray(
  value: unknown[] | undefined | null,
): value is [] | undefined | null {
  return value == null || value.length === 0;
}
