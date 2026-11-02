import { Writable } from 'node:stream';
import { pino, type DestinationStream } from 'pino';
import {
  buildPinoOptions,
  createPinoParams,
  formatPrettyEntry,
  resolveLevel,
  toPinoLevel,
} from './logger.config.js';

// ── capture helper ───────────────────────────────────────────────────────

function captureDestination(): {
  destination: DestinationStream;
  lines: string[];
} {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  }) as DestinationStream;
  return { destination, lines };
}

function makeLogger(
  level: 'error' | 'warn' | 'info' | 'debug' | 'verbose' = 'debug',
) {
  const capture = captureDestination();
  const logger = pino(buildPinoOptions(level), capture.destination);
  const lastEntry = (): Record<string, unknown> =>
    JSON.parse(capture.lines[capture.lines.length - 1]!.trim()) as Record<
      string,
      unknown
    >;
  return { logger, lines: capture.lines, lastEntry };
}

// ── OTel span mock ───────────────────────────────────────────────────────
let mockSpanContext: { traceId: string; spanId?: string } | undefined;

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getActiveSpan: () =>
      mockSpanContext === undefined
        ? undefined
        : { spanContext: () => mockSpanContext },
  },
}));

afterEach(() => {
  mockSpanContext = undefined;
});

// ── level resolution ─────────────────────────────────────────────────────

describe('resolveLevel', () => {
  it('uses debug level in development', () => {
    expect(resolveLevel('development', '')).toBe('debug');
  });

  it('uses info level in production', () => {
    expect(resolveLevel('production', '')).toBe('info');
  });

  it('uses error level in test mode for minimal output', () => {
    expect(resolveLevel('test', '')).toBe('error');
  });

  it('honors an explicit log level override', () => {
    expect(resolveLevel('production', 'debug')).toBe('debug');
    expect(resolveLevel('test', 'verbose')).toBe('verbose');
  });

  it('falls back to development when nodeEnv is empty', () => {
    expect(resolveLevel('', '')).toBe('debug');
  });

  it('ignores a value outside the application vocabulary', () => {
    // `LOG_LEVEL=http` is a Winston artefact; the env schema rejects it, and a
    // stale runtime snapshot must not silently disable logging.
    expect(resolveLevel('production', 'http')).toBe('info');
  });
});

describe('toPinoLevel', () => {
  it('maps verbose onto trace and leaves the rest unchanged', () => {
    expect(toPinoLevel('verbose')).toBe('trace');
    expect(toPinoLevel('debug')).toBe('debug');
    expect(toPinoLevel('error')).toBe('error');
  });
});

// ── module params ────────────────────────────────────────────────────────

describe('createPinoParams', () => {
  it('exposes the resolved level through the pinoHttp tuple', () => {
    const params = createPinoParams({
      nodeEnv: 'production',
      logLevel: '',
      logFormat: undefined,
      victoriaLogsUrl: undefined,
    });

    const [options] = params.pinoHttp as [Record<string, unknown>, unknown];
    expect(options['level']).toBe('info');
    expect(options['autoLogging']).toBe(false);
  });

  it('adds a second destination in production when VictoriaLogs is configured', () => {
    const without = createPinoParams({
      nodeEnv: 'production',
      logLevel: '',
      logFormat: undefined,
      victoriaLogsUrl: undefined,
    });
    const withVictoria = createPinoParams({
      nodeEnv: 'production',
      logLevel: '',
      logFormat: undefined,
      victoriaLogsUrl: 'http://127.0.0.1:9428/insert/jsonline',
    });

    // A multistream is a different object than the single stdout destination.
    expect(withVictoria.pinoHttp).not.toEqual(without.pinoHttp);
  });
});

// ── JSON field contract ──────────────────────────────────────────────────

describe('JSON field contract', () => {
  it('keeps message/timestamp as strings and level as a label', () => {
    const { logger, lastEntry } = makeLogger();

    logger.info({ context: 'Test', userId: 'u1' }, 'hello');

    const entry = lastEntry();
    expect(entry['message']).toBe('hello');
    expect(entry['level']).toBe('info');
    expect(typeof entry['timestamp']).toBe('string');
    expect(new Date(entry['timestamp'] as string).toString()).not.toBe(
      'Invalid Date',
    );
  });

  it('puts caller metadata at the top level, not under a params object', () => {
    const { logger, lastEntry } = makeLogger();

    logger.warn({ context: 'Test', userId: 'u1', count: 2 }, 'careful');

    const entry = lastEntry();
    expect(entry['userId']).toBe('u1');
    expect(entry['count']).toBe(2);
    expect(entry).not.toHaveProperty('params');
  });

  it('omits pid and hostname', () => {
    const { logger, lastEntry } = makeLogger();

    logger.info('hello');

    expect(lastEntry()).not.toHaveProperty('pid');
    expect(lastEntry()).not.toHaveProperty('hostname');
  });
});

// ── OTel trace correlation ───────────────────────────────────────────────

describe('otel trace mixin', () => {
  it('injects the active span ids as top-level fields', () => {
    const { logger, lastEntry } = makeLogger();
    mockSpanContext = {
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: 'fedcba9876543210',
    };

    logger.info('hello');

    const entry = lastEntry();
    expect(entry['trace_id']).toBe('0123456789abcdef0123456789abcdef');
    expect(entry['span_id']).toBe('fedcba9876543210');
  });

  it('adds no trace ids outside a span', () => {
    const { logger, lastEntry } = makeLogger();

    logger.info('hello');

    const entry = lastEntry();
    expect(entry).not.toHaveProperty('trace_id');
    expect(entry).not.toHaveProperty('span_id');
  });

  it('keeps explicitly provided trace ids over the span ones', () => {
    const { logger, lastEntry } = makeLogger();
    mockSpanContext = {
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: 'fedcba9876543210',
    };

    logger.info({ trace_id: 'explicit-trace' }, 'hello');

    expect(lastEntry()['trace_id']).toBe('explicit-trace');
  });
});

// ── Error serialization ──────────────────────────────────────────────────

describe('error serialization', () => {
  it('keeps the error message and stack instead of serializing to {}', () => {
    const { logger, lastEntry } = makeLogger();

    logger.error({ error: new Error('boom') }, 'failed');

    const error = lastEntry()['error'] as Record<string, unknown>;
    expect(error['message']).toBe('boom');
    expect(typeof error['stack']).toBe('string');
    expect(error['stack']).toContain('boom');
  });

  it('passes a non-Error error payload through unchanged', () => {
    const { logger, lastEntry } = makeLogger();

    // Domain failures are plain discriminated unions, not Error instances.
    logger.warn(
      { error: { _tag: 'DomainFailure', code: 'INTERNAL_ERROR' } },
      'x',
    );

    expect(lastEntry()['error']).toEqual({
      _tag: 'DomainFailure',
      code: 'INTERNAL_ERROR',
    });
  });
});

// ── Development console format ───────────────────────────────────────────

describe('formatPrettyEntry', () => {
  it('prints timestamp, level, context and message', () => {
    const line = formatPrettyEntry({
      message: 'hello',
      level: 'info',
      context: 'Test',
      timestamp: '2026-10-27 10:00:00.000',
    });

    expect(line).toContain('2026-10-27 10:00:00.000');
    expect(line).toContain('info');
    expect(line).toContain('[Test]');
    expect(line).toContain('hello');
  });

  it('shows the trace tag when a trace id is present', () => {
    const line = formatPrettyEntry({
      message: 'hello',
      level: 'info',
      context: 'Test',
      trace_id: '0123456789abcdef',
      span_id: 'fedcba98',
    });

    expect(line).toContain('trace=01234567:fedcba98');
  });

  it('omits the trace tag when no trace id is present', () => {
    const line = formatPrettyEntry({
      message: 'hello',
      level: 'info',
      context: 'Test',
    });

    expect(line).not.toContain('trace=');
  });

  it('appends caller metadata as a key=value suffix', () => {
    const line = formatPrettyEntry({
      message: 'hello',
      level: 'info',
      context: 'Test',
      userId: 'u1',
    });

    expect(line).toContain('{userId=u1}');
  });

  it('prints the error stack on its own line', () => {
    const line = formatPrettyEntry({
      message: 'failed',
      level: 'error',
      context: 'Test',
      error: { message: 'boom', stack: 'Error: boom\n    at one' },
    });

    expect(line).toContain('at one');
  });
});
