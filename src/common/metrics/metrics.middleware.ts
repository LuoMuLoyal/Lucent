import { performance } from 'node:perf_hooks';
import type { NextFunction, Request, Response } from 'express';
import type { MetricsService } from './metrics.service';

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
function normalizeRoute(req: Request): string {
  const url = req.originalUrl || req.url || '';
  const path = url.split('?')[0] ?? '';
  return path
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ':id',
    )
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

function shouldSkip(url: string): boolean {
  return SKIP_PATH_PATTERNS.some((pattern) => pattern.test(url));
}

/**
 * Creates an Express middleware that records HTTP request duration and count
 * metrics. Uses `res.on('finish')` to capture the final status code, including
 * responses produced by exception filters.
 *
 * Registered in `setupApp` before NestJS routing so it wraps all requests.
 */
export function createMetricsMiddleware(metricsService: MetricsService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!metricsService.is_enabled() || shouldSkip(req.url)) {
      next();
      return;
    }

    const start = performance.now();

    res.on('finish', () => {
      const durationSeconds = (performance.now() - start) / 1000;
      const route = normalizeRoute(req);
      metricsService.recordHttpRequest(
        req.method,
        route,
        res.statusCode,
        durationSeconds,
      );
    });

    next();
  };
}
