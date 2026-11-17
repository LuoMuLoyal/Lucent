import { pino, stdSerializers, type DestinationStream, type Level } from 'pino';
import type { LoggerOptions } from 'pino';
import type { Options as PinoHttpOptions } from 'pino-http';
import type { Params } from 'nestjs-pino';
import { Writable } from 'node:stream';
import { getActiveTraceIds } from './trace-context.utils.js';
import { VictoriaLogsStream } from './victorialogs-stream.js';

/**
 * Application log-level vocabulary.
 *
 * Deliberately narrower than pino's: this is what `LOG_LEVEL` accepts (see
 * `environment.validation.ts` / `ops.schema.ts`) and what the ops runtime
 * config publishes. Pino's `trace` is reachable through `verbose`, the name
 * NestJS's `LoggerService` already uses for that tier.
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

const LOG_LEVELS: ReadonlySet<LogLevel> = new Set<LogLevel>([
  'error',
  'warn',
  'info',
  'debug',
  'verbose',
]);

/** True when `value` is part of the auditable `LOG_LEVEL` vocabulary. */
export function isLogLevel(value: string): value is LogLevel {
  return LOG_LEVELS.has(value as LogLevel);
}

/**
 * Resolves the effective log level.
 *
 * - Test: defaults to 'error' (minimal output; set LOG_LEVEL=debug to see more)
 * - Production: defaults to 'info'
 * - Development: defaults to 'debug'
 *
 * An explicit LOG_LEVEL always wins.
 *
 * Exported because the runtime-config ops family derives its baseline from the
 * same resolution: the remote snapshot starts from "what the process would have
 * logged anyway", not from a second copy of this map.
 */
export function resolveLevel(nodeEnv: string, logLevel: string): LogLevel {
  const candidate = logLevel as LogLevel;
  if (logLevel && LOG_LEVELS.has(candidate)) {
    return candidate;
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
 * Maps the application vocabulary onto pino's.
 *
 * `verbose` is NestJS's name for the tier below `debug`; pino calls it `trace`.
 */
export function toPinoLevel(level: LogLevel): Level {
  return level === 'verbose' ? 'trace' : level;
}

// ── Development console formatting ───────────────────────────────────────

const C = {
  reset: '\u001B[0m',
  green: '\u001B[32m',
  gray: '\u001B[90m',
} as const;

const LEVEL_COLORS: Record<string, string> = {
  error: '\u001B[31m',
  warn: '\u001B[33m',
  info: '\u001B[32m',
  debug: '\u001B[36m',
  trace: '\u001B[90m',
  fatal: '\u001B[35m',
};

/**
 * Keys that belong to the log-entry scaffolding rather than to caller metadata,
 * so they must not be dumped into the dev console's `{k=v}` suffix.
 */
const RESERVED_KEYS = new Set([
  'level',
  'message',
  'timestamp',
  'context',
  'trace_id',
  'span_id',
]);

/**
 * `<ts> <level> [context] [trace:span] message {meta}`.
 *
 * Errors keep their stack inside `error.stack` (pino's serializer shape), so the
 * console prints it on the following lines rather than as a separate field.
 */
export function formatPrettyEntry(entry: Record<string, unknown>): string {
  const ts = typeof entry['timestamp'] === 'string' ? entry['timestamp'] : '';
  const level = typeof entry['level'] === 'string' ? entry['level'] : 'info';
  const context =
    typeof entry['context'] === 'string' ? entry['context'] : 'App';
  const message = typeof entry['message'] === 'string' ? entry['message'] : '';
  const traceId =
    typeof entry['trace_id'] === 'string' ? entry['trace_id'] : undefined;
  const spanId =
    typeof entry['span_id'] === 'string' ? entry['span_id'] : undefined;

  const tracePart =
    traceId === undefined
      ? undefined
      : traceId.length <= 8
        ? traceId
        : traceId.slice(0, 8);
  const spanPart =
    spanId === undefined
      ? undefined
      : spanId.length <= 8
        ? spanId
        : spanId.slice(0, 8);

  const traceTag =
    tracePart === undefined
      ? ''
      : `${C.green}[trace=${tracePart}${spanPart === undefined ? '' : `:${spanPart}`}]${C.reset} `;
  const color = LEVEL_COLORS[level] ?? '';
  const levelTag = `${color}${level.padEnd(5)}${C.reset}`;
  const meta = formatMeta(entry);
  const metaTag = meta === undefined ? '' : ` ${C.gray}${meta}${C.reset}`;

  const line = `${C.gray}${ts}${C.reset} ${levelTag} ${C.gray}[${context}]${C.reset} ${traceTag}${message}${metaTag}`;

  const errorStack = readErrorStack(entry['error']);
  return errorStack === undefined ? line : `${line}\n${errorStack}`;
}

function readErrorStack(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const stack = (error as Record<string, unknown>)['stack'];
  return typeof stack === 'string' ? stack : undefined;
}

function formatMeta(entry: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(entry)) {
    if (RESERVED_KEYS.has(key) || key === 'error') continue;
    parts.push(
      typeof value === 'string'
        ? `${key}=${value}`
        : `${key}=${JSON.stringify(value)}`,
    );
  }
  return parts.length > 0 ? `{${parts.join(', ')}}` : undefined;
}

/**
 * Human-readable destination for the development console.
 *
 * A plain `Writable` rather than a pino transport: transports run in a worker
 * thread and write straight to a file descriptor, which is exactly why the
 * previous pino setup's output could not be intercepted by the test runner.
 * This stays in-process, so `console`-level interception and test capture work.
 */
export function createPrettyStream(
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): DestinationStream {
  let pending = '';
  return new Writable({
    write(
      chunk: Buffer | string,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void,
    ) {
      pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        try {
          write(formatPrettyEntry(JSON.parse(line) as Record<string, unknown>));
          // eslint-disable-next-line error-handling/no-silent-catch -- a formatting failure must not drop the line: the raw entry is written in the catch below
        } catch {
          write(line);
        }
      }
      callback();
    },
  });
}

// ── Logger construction ──────────────────────────────────────────────────

export interface LoggerOptionsInput {
  /** Active environment: 'development' | 'production' | 'test'. */
  nodeEnv: string;
  /** Explicit log level override (from env var or YAML). */
  logLevel: string | undefined;
  /** Explicit log format override: 'pretty' | 'json' | undefined. */
  logFormat: string | undefined;
  /** VictoriaLogs ingest URL; when set in production, a stream is added. */
  victoriaLogsUrl: string | undefined;
  /**
   * Optional destination override (tests inject a capturing stream here).
   * When provided it replaces the console/pretty destination entirely.
   */
  destination?: DestinationStream;
  /** Sink for ingest warnings; defaults to `console.error`. */
  onWarn?: (message: string) => void;
}

/**
 * Builds the pino options shared by every environment.
 *
 * The field contract is kept identical to the previous implementation so
 * VictoriaLogs queries and dashboards keep working:
 * - `level` is the **string label**, not pino's numeric level;
 * - `message` / `timestamp` / `context` keep their names;
 * - caller metadata lands at the **top level** (`logger.warn({ error }, 'msg')`),
 *   not nested under a `params` object;
 * - `trace_id` / `span_id` are injected while an OTel span is active.
 */
export function buildPinoOptions(level: LogLevel): LoggerOptions {
  return {
    level: toPinoLevel(level),
    // pid/hostname are added by the container platform; the previous output
    // shape did not carry them and VictoriaLogs already tags them.
    // `null` (not `undefined`) is pino's documented way to disable `base`.
    base: null,
    messageKey: 'message',
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    // Injected for every entry; explicitly supplied caller fields still win.
    mixin: () => {
      const { traceId, spanId } = getActiveTraceIds();
      const ids: Record<string, string> = {};
      if (traceId !== undefined) ids['trace_id'] = traceId;
      if (spanId !== undefined) ids['span_id'] = spanId;
      return ids;
    },
    serializers: {
      // `logger.warn({ error }, 'msg')` must keep message + stack: pino's
      // default would serialize an Error to `{}` because its own enumerable
      // properties are empty.
      error: stdSerializers.err,
      // Request binding is deliberately not surfaced. The application already
      // correlates logs through OTel trace ids and emits its own access log;
      // pino-http's `req` serializer would additionally copy headers, which
      // include credentials.
      req: () => undefined,
      res: () => undefined,
    },
  };
}

/**
 * Builds the `nestjs-pino` module params for the running environment.
 *
 * Destination choice:
 * - development: in-process pretty stream (or JSON when `LOG_FORMAT=json`);
 * - test/production: JSON to stdout (fd 1) — nothing is written to the
 *   filesystem, the container collector owns retention;
 * - production + `VICTORIALOGS_URL`: an additional NDJSON stream POSTs batches
 *   to VictoriaLogs.
 */
export function createPinoParams(input: LoggerOptionsInput): Params {
  const env = input.nodeEnv || 'development';
  const level = resolveLevel(env, input.logLevel ?? '');

  const logFormatOverride = (input.logFormat ?? '').toLowerCase();
  const useJsonFormat =
    logFormatOverride === 'json' ||
    (logFormatOverride !== 'pretty' && env !== 'development');

  const destinations: {
    level: Level;
    stream: DestinationStream;
  }[] = [];

  const pinoLevel = toPinoLevel(level);

  if (input.destination !== undefined) {
    destinations.push({ level: pinoLevel, stream: input.destination });
  } else if (useJsonFormat) {
    destinations.push({ level: pinoLevel, stream: pino.destination(1) });
  } else {
    destinations.push({ level: pinoLevel, stream: createPrettyStream() });
  }

  const victoriaLogsUrl = input.victoriaLogsUrl ?? '';
  if (env === 'production' && victoriaLogsUrl) {
    const onWarn =
      input.onWarn ??
      ((message: string) => {
        console.error(message);
      });
    destinations.push({
      level: pinoLevel,
      stream: new VictoriaLogsStream({
        url: victoriaLogsUrl,
        batchCount: 100,
        batchIntervalMs: 5000,
        onWarn,
      }),
    });
  }

  const [primary] = destinations;
  const stream =
    destinations.length === 1 && primary !== undefined
      ? primary.stream
      : pino.multistream(destinations);

  // `autoLogging` and the pino-http request binding belong to the HTTP layer,
  // not to pino's own options, so they are added here rather than in
  // `buildPinoOptions`.
  const httpOptions = {
    ...buildPinoOptions(level),
    // Every request already produces one structured access entry from the
    // Fastify `onResponse` hook; pino-http's own line would duplicate it.
    autoLogging: false,
  } as unknown as PinoHttpOptions;

  return {
    pinoHttp: [httpOptions, stream],
  };
}
