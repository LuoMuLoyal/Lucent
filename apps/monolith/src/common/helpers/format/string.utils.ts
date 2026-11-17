/**
 * Shared string utilities.
 */

/** Returns true for `null`, `undefined`, non-strings, or whitespace-only strings. */
export function isBlank(value: unknown): boolean {
  if (value == null) {
    return true;
  }
  if (typeof value !== 'string') {
    return true;
  }
  return value.trim().length === 0;
}

/** Trims whitespace and returns null if the value is not a non-empty string. */
export function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Trims whitespace and converts to lowercase.
 * Used for email normalization across auth flows.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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

/**
 * Truncates a string to a maximum length, appending a suffix when truncated.
 * Returns the original string when it fits.
 */
export function truncate(
  value: string,
  maxLength: number,
  suffix = '...',
): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.substring(0, maxLength)}${suffix}`;
}

import { randomUUID } from 'node:crypto';

/**
 * Generates a stable, globally unique identifier with a human-readable prefix.
 * Useful for proposal/action IDs that must not collide across requests.
 */
export function generatePrefixedId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
