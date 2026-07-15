/**
 * URL paths that should not be recorded as HTTP metrics.
 * - `/metrics` — the Prometheus scrape endpoint itself
 * - `/api/v1/health*` — health check probes (high frequency, no business value)
 */
const SKIP_PATH_PATTERNS = [/^\/metrics$/, /^\/api\/v1\/health/];

/**
 * Normalises a URL path by replacing UUIDs and numeric ID segments with `:id`
 * to prevent unbounded label cardinality in Prometheus.
 */
export function normalizeRoute(url: string): string {
  const path = url.split('?')[0] ?? '';
  return path
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ':id',
    )
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

export function shouldSkip(url: string): boolean {
  return SKIP_PATH_PATTERNS.some((pattern) => pattern.test(url));
}
