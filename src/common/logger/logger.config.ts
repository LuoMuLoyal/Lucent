import type { WinstonModuleOptions } from 'nest-winston';
import { transports as winstonTransports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { EnvKey } from '../../config/env-keys.enum';

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
 * Winston logger configuration for nest-winston.
 *
 * - Development: `Console` with `format.simple()` (human-readable, colorized)
 * - Production: `Console` (JSON) + `DailyRotateFile` (daily, 500 MB max)
 * - Test: `Console` at `error` level only (near-silent)
 *
 * Per-request HTTP access logging is intentionally NOT configured here —
 * that responsibility is delegated to:
 *   - Nginx access_log (IP / UA / bytes / referer)
 *   - ApiExceptionFilter (4xx/5xx with requestId + error stack)
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
      transports: [consoleTransport, rotateTransport],
    };
  }

  return {
    transports: [consoleTransport],
  };
}
