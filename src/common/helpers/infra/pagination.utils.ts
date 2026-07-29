/**
 * Shared pagination utilities.
 */

/** Default page size when none is provided. */
export const DEFAULT_PAGE_SIZE = 50;

/** Maximum allowed page size. */
export const MAX_PAGE_SIZE = 100;

/**
 * Clamps a page number to a valid 1-based value.
 *
 * Values less than 1 (including 0 and negatives) are clamped to 1.
 */
export function clampPage(page: number): number {
  return Math.max(page, 1);
}

/**
 * Clamps a page size to the range [1, MAX_PAGE_SIZE].
 *
 * This prevents clients from requesting excessively large result sets
 * that could cause memory or performance issues.
 */
export function clampPageSize(pageSize: number, max = MAX_PAGE_SIZE): number {
  return Math.min(Math.max(pageSize, 1), max);
}
