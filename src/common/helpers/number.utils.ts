/**
 * Shared number utilities.
 */

/** Rounds a number to the given number of fraction digits. */
export function roundNumber(value: number, fractionDigits: number): number {
  return Number(value.toFixed(fractionDigits));
}

/**
 * Returns the input as a number if it is a valid, non-NaN number;
 * otherwise returns null.
 */
export function normalizeNullableNumber(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }

  return value;
}
