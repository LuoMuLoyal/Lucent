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

// ── ANSI color constants (used only for requestId highlighting) ──────────

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
} as const;

/**
 * Keys that are part of Winston/NestJS log infrastructure and should not
 * appear in the metadata suffix of the dev console format.
 */
const RESERVED_KEYS = new Set([
  'level',
  'message',
  'timestamp',
  'context',
  'requestId',
  'stack',
  'trace',
  'splat',
  Symbol.for('level'),
  Symbol.for('message'),
  Symbol.for('splat'),
]);

/**
 * Extracts non-reserved metadata fields from the log info object and
 * formats them as `{key=value, key2=value2}` for the dev console.
 * Returns `undefined` when no metadata is present.
 */
function formatMeta(info: Record<string, unknown>): string | undefined {
  const entries = Object.entries(info).filter(
    ([key]) => !RESERVED_KEYS.has(key) && typeof key !== 'symbol',
  );
  if (entries.length === 0) return undefined;
  const parts = entries.map(([k, v]) =>
    typeof v === 'string' ? `${k}=${v}` : `${k}=${JSON.stringify(v)}`,
  );
  return `{${parts.join(', ')}}`;
}

/**
 * Human-readable printf format for the development console.
 *
 * Layout:
 *   <timestamp> <level> [context] [reqId] message {meta}
 *   <stack>                       ← only for errors with a stack trace
 *
 * - `timestamp()`  — `YYYY-MM-DD HH:mm:ss.SSS`
 * - `colorize()`   — Winston handles level coloring; requestId uses manual
 *                    green ANSI for visual prominence.
 * - `printf()`     — full layout control with metadata + stack.
 */
const devConsoleFormat = winstonFormat.combine(
  requestIdFormat(),
  winstonFormat.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winstonFormat.colorize(),
  winstonFormat.printf((info: Record<string, unknown>) => {
    const ts = typeof info['timestamp'] === 'string' ? info['timestamp'] : '';
    const level = typeof info['level'] === 'string' ? info['level'] : 'info';
    const context =
      typeof info['context'] === 'string' ? info['context'] : 'App';
    const message = typeof info['message'] === 'string' ? info['message'] : '';
    const requestId =
      typeof info['requestId'] === 'string' ? info['requestId'] : undefined;
    const stack =
      typeof info['stack'] === 'string'
        ? info['stack']
        : typeof info['trace'] === 'string'
          ? info['trace']
          : undefined;

    const reqTag = requestId
      ? `${C.green}[${requestId.length <= 8 ? requestId : requestId.slice(0, 8)}]${C.reset} `
      : '';
    const meta = formatMeta(info);
    const metaTag = meta ? `${C.gray}${meta}${C.reset}` : '';

    const line = `${C.gray}${ts}${C.reset} ${level} ${C.gray}[${context}]${C.reset} ${reqTag}${message}${metaTag ? ' ' + metaTag : ''}`;
    return stack ? `${line}\n${stack}` : line;
  }),
);

/**
 * JSON format for production and test environments.
 * Same as before, but now includes a top-level `timestamp` field for
 * log-aggregation tools (ELK / Loki / CloudWatch).
 */
const prodJsonFormat = winstonFormat.combine(
  requestIdFormat(),
  winstonFormat.timestamp(),
  winstonFormat.json(),
);

/**
 * Winston logger configuration for nest-winston.
 *
 * Format selection:
 * - **Development**: colorized `printf` format — timestamp, level, context,
 *   requestId (first 8 chars), message, metadata, and stack trace. Optimized
 *   for human readability during integration debugging.
 * - **Production / Test**: single-line JSON with `timestamp`. Optimized for
 *   machine ingestion (ELK, Loki, CloudWatch, Jest `JSON.parse` assertions).
 * - The `LOG_FORMAT` env var (`pretty` or `json`) overrides the default at any
 *   environment, e.g. `LOG_FORMAT=json` in dev to pipe logs through `jq`.
 *
 * Transport configuration:
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

  // LOG_FORMAT overrides the environment default. `pretty` forces the dev
  // console format; `json` forces JSON — useful in any direction.
  const logFormatOverride = (
    process.env[EnvKey.LOG_FORMAT] ?? ''
  ).toLowerCase();
  const useJsonFormat =
    logFormatOverride === 'json' ||
    (logFormatOverride !== 'pretty' && env !== 'development');

  const format = useJsonFormat ? prodJsonFormat : devConsoleFormat;

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
