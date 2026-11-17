import { z } from 'zod';

/**
 * Overall status of a health check run (terminus `HealthCheckResult.status`).
 */
export const HEALTH_CHECK_STATUSES = [
  'ok',
  'error',
  'degraded',
  'shutting_down',
] as const;

/** Per-indicator status (terminus `HealthIndicatorStatus`). */
export const HEALTH_INDICATOR_STATUSES = ['up', 'degraded', 'down'] as const;

/**
 * One entry inside `info` / `error` / `details`, keyed by indicator name
 * (`database`, `cache`, `app`). Kept loose: the diagnostic payload differs per
 * indicator (and per `deep` vs `ready`), so only the common fields are typed
 * and any additional key is allowed.
 */
export const healthIndicatorResultSchema = z
  .looseObject({
    status: z.enum(HEALTH_INDICATOR_STATUSES),
    message: z.string().optional(),
    durationMs: z.number().optional(),
    driver: z.string().optional(),
    probe: z.string().optional(),
    backend: z.string().optional(),
    mode: z.string().optional(),
    name: z.string().optional(),
    env: z.string().optional(),
    pid: z.number().optional(),
    uptimeSeconds: z.number().optional(),
    memoryRssBytes: z.number().optional(),
    memoryHeapUsedBytes: z.number().optional(),
  })
  .meta({ example: { status: 'up', durationMs: 4 } });

/** Map of indicator name → indicator result. */
export const healthIndicatorMapSchema = z.record(
  z.string(),
  healthIndicatorResultSchema,
);

/**
 * Native terminus health-check response body, used by all four health
 * endpoints (`/health`, `/health/live`, `/health/ready`, `/health/deep`).
 *
 * `info` holds the healthy indicators, `error` the failing ones, and `details`
 * every indicator regardless of status. The 503 responses carry the same body.
 */
export const healthCheckResultSchema = z
  .object({
    status: z.enum(HEALTH_CHECK_STATUSES),
    info: healthIndicatorMapSchema,
    error: healthIndicatorMapSchema,
    details: healthIndicatorMapSchema,
  })
  .meta({
    example: {
      status: 'ok',
      info: {
        database: { status: 'up' },
        cache: { status: 'up' },
        app: { status: 'up' },
      },
      error: {},
      details: {
        database: { status: 'up' },
        cache: { status: 'up' },
        app: { status: 'up' },
      },
    },
  });

export type HealthIndicatorResultDto = z.infer<
  typeof healthIndicatorResultSchema
>;
export type HealthCheckResultDto = z.infer<typeof healthCheckResultSchema>;
