import type { WinstonModuleOptions } from 'nest-winston';
import {
  format as winstonFormat,
  transports as winstonTransports,
} from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { EnvKey } from '../../config/env-keys.enum';
import { requestContextStorage } from './request-context.service';

type LogLevel =
  | 'error'
  | 'warn'
  | 'info'
  | 'http'
  | 'verbose'
  | 'debug'
  | 'silly';

/**
 * Resolves the effective log level.
 *
 * - Test: defaults to 'error' (minimal output; set LOG_LEVEL=debug to see more)
 * - Production: defaults to 'info'
 * - Development: defaults to 'debug'
 *
 * An explicit LOG_LEVEL always wins.
 */
function resolveLevel(nodeEnv: string, logLevel: string): LogLevel {
  if (logLevel) {
    return logLevel as LogLevel;
  }
  if (nodeEnv === 'test') {
    return 'error';
  }
  if (nodeEnv === 'production') {
    return 'info';
  }
  return 'debug';
}

/**
 * Lifts the request ID stored in AsyncLocalStorage (populated by the
 * preHandler hook in `setupApp`) onto the log entry as a top-level
 * `requestId` field, so every line emitted while handling a request can be
 * correlated by it. Entries logged outside a request lifecycle (bootstrap,
 * cron, queue workers) simply carry no `requestId`. An explicitly supplied
 * `requestId` in the log metadata always wins.
 */
const requestIdFormat = winstonFormat((info) => {
  if (info['requestId'] === undefined) {
    const requestId = requestContextStorage.getStore()?.requestId;
    if (requestId) {
      info['requestId'] = requestId;
    }
  }
  return info;
});

/**
 * Winston logger configuration for nest-winston.
 *
 * - Format: single-line JSON on every transport; `requestIdFormat` injects
 *   the AsyncLocalStorage request ID as a top-level `requestId` field.
 * - Development: `Console` at debug level
 * - Production: `Console` + `DailyRotateFile` (daily, 500 MB max)
 * - Test: `Console` at `error` level only (near-silent)
 *
 * Per-request HTTP access logging IS emitted, but not from this file:
 * a Fastify `onResponse` hook in `setupApp` writes one structured entry per
 * completed request (requestId, method, route pattern, statusCode,
 * durationMs; `error` level for 5xx, `info` otherwise) and skips
 * high-frequency probes (`/api/v1/health*`, `/metrics`).
 * Complementary signals remain:
 *   - Nginx access_log (IP / UA / bytes / referer)
 *   - ApiExceptionFilter (4xx/5xx with error stack)
 *   - SlowRequestInterceptor (configurable threshold + handler name)
 *   - Prometheus histogram + counter (aggregated latency / Grafana)
 */
export function createLoggerOptions(
  nodeEnv: string,
  logLevel: string,
): WinstonModuleOptions {
  const env = nodeEnv || process.env[EnvKey.NODE_ENV] || 'development';
  const level = resolveLevel(env, logLevel);
  const isProduction = env === 'production';

  const format = winstonFormat.combine(requestIdFormat(), winstonFormat.json());

  const consoleTransport = new winstonTransports.Console({
    level,
    handleExceptions: true,
  });

  if (isProduction) {
    const rotateTransport = new DailyRotateFile({
      filename: 'lucent-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      dirname: './logs',
      maxSize: '500m',
      maxFiles: '14d',
      zippedArchive: true,
      level,
    });

    return {
      format,
      transports: [consoleTransport, rotateTransport],
    };
  }

  return {
    format,
    transports: [consoleTransport],
  };
}
