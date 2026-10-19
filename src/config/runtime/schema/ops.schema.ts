/**
 * Ops family: log level, slow-path thresholds, metrics switch and the global
 * rate-limit window.
 *
 * `LOG_LEVEL` and the thresholds are read per observation; `METRICS_ENABLED` is
 * checked per request. `THROTTLE_*` is enforced by the runtime throttler guard,
 * which reads it every request — the schema floors keep a mistyped value from
 * locking the whole API (`limit >= 1`, `ttl >= 1s`).
 */

import { EnvKey } from '../../env/env-keys.enum.js';
import { resolveLevel } from '../../../common/logger/logger.config.js';
import {
  booleanField,
  enumField,
  numberField,
  type RuntimeFieldSpec,
} from './field-spec.js';

export const LOG_LEVELS = [
  'error',
  'warn',
  'info',
  'debug',
  'verbose',
] as const;

export type RuntimeLogLevel = (typeof LOG_LEVELS)[number];

const MIN_SLOW_THRESHOLD_MS = 10;
const MAX_SLOW_THRESHOLD_MS = 600_000;
const MIN_THROTTLE_TTL_MS = 1_000;
const MAX_THROTTLE_TTL_MS = 3_600_000;
const MIN_THROTTLE_LIMIT = 1;
const MAX_THROTTLE_LIMIT = 1_000;

function isRuntimeLogLevel(value: string): value is RuntimeLogLevel {
  return LOG_LEVELS.some((level) => level === value);
}

/**
 * Baseline log level: `LOG_LEVEL` when set, else the per-environment default
 * `logger.config.ts` applies at startup. Delegating instead of copying the
 * three-way map keeps "what does unset mean" in one place.
 */
function logLevelBaseline(): RuntimeLogLevel {
  const resolved = resolveLevel(
    process.env[EnvKey.NODE_ENV] ?? '',
    process.env[EnvKey.LOG_LEVEL] ?? '',
  );
  return isRuntimeLogLevel(resolved) ? resolved : 'info';
}

export const opsRuntimeFields = {
  [EnvKey.LOG_LEVEL]: enumField({
    family: 'ops',
    values: LOG_LEVELS,
    defaultValue: logLevelBaseline,
  }),
  [EnvKey.SLOW_REQUEST_THRESHOLD_MS]: numberField({
    family: 'ops',
    min: MIN_SLOW_THRESHOLD_MS,
    max: MAX_SLOW_THRESHOLD_MS,
    defaultValue: 2_000,
  }),
  [EnvKey.SLOW_QUERY_THRESHOLD_MS]: numberField({
    family: 'ops',
    min: MIN_SLOW_THRESHOLD_MS,
    max: MAX_SLOW_THRESHOLD_MS,
    defaultValue: 500,
  }),
  [EnvKey.METRICS_ENABLED]: booleanField({
    family: 'ops',
    defaultValue: true,
  }),
  [EnvKey.THROTTLE_TTL_MS]: numberField({
    family: 'ops',
    min: MIN_THROTTLE_TTL_MS,
    max: MAX_THROTTLE_TTL_MS,
    defaultValue: 60_000,
  }),
  [EnvKey.THROTTLE_LIMIT]: numberField({
    family: 'ops',
    min: MIN_THROTTLE_LIMIT,
    max: MAX_THROTTLE_LIMIT,
    defaultValue: 100,
  }),
} satisfies Record<string, RuntimeFieldSpec<unknown>>;
