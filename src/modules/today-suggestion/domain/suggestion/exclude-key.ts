/**
 * Canonical cache key fragment for a "minus these cards" query.
 *
 * The order of `excludeIds` must not change which cache entry a request hits,
 * so it is sorted here. An empty set collapses to `none` rather than an empty
 * string, which keeps the composed key readable.
 */
export function buildExcludeKey(excludeIds?: string[]): string {
  if (excludeIds == null || excludeIds.length === 0) return 'none';
  return [...excludeIds].sort().join(',');
}
