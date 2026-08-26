import { Writable } from 'node:stream';
import { createLogger, transports as winstonTransports } from 'winston';
import { createLoggerOptions } from './logger.config';
import type { WinstonModuleOptions } from 'nest-winston';

interface LeveledTransport {
  level: string;
}

function getConsoleLevel(options: WinstonModuleOptions): string {
  const transports = options.transports;
  const arr = Array.isArray(transports) ? transports : [transports];
  return (arr[0] as unknown as LeveledTransport).level;
}

// ── shared capturing-logger helpers ──────────────────────────────────────

function createCapturingLogger(
  nodeEnv: string,
  level: string = 'silly',
  extra?: { logFormat?: string; victoriaLogsUrl?: string },
): {
  logger: ReturnType<typeof createLogger>;
  lines: string[];
  waitForLine: (count: number) => Promise<void>;
} {
  const lines: string[] = [];
  const waiters: Array<() => void> = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
      for (const notify of waiters.splice(0)) {
        notify();
      }
    },
  });
  const options = createLoggerOptions({
    nodeEnv,
    logLevel: level,
    logFormat: extra?.logFormat,
    victoriaLogsUrl: extra?.victoriaLogsUrl,
  });
  const logger = createLogger({
    ...options,
    transports: [new winstonTransports.Stream({ stream })],
  });
  const waitForLine = async (count: number): Promise<void> => {
    while (lines.length < count) {
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    }
  };
  return { logger, lines, waitForLine };
}

async function logAndFlush(
  capture: ReturnType<typeof createCapturingLogger>,
  message: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const written = capture.waitForLine(capture.lines.length + 1);
  if (meta) {
    capture.logger.info(message, meta);
  } else {
    capture.logger.info(message);
  }
  await written;
}

// ── OTel span mock ────────────────────────────────────────────────────────
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

describe('createLoggerOptions', () => {
  it('uses debug level in development', () => {
    const options = createLoggerOptions({
      nodeEnv: 'development',
      logLevel: '',
      logFormat: undefined,
      victoriaLogsUrl: undefined,
    });

    expect(options.transports).toHaveLength(1);
    expect(getConsoleLevel(options)).toBe('debug');
  });

  it('uses info level in production with console + VictoriaLogs transports', () => {
    const options = createLoggerOptions({
      nodeEnv: 'production',
      logLevel: '',
      logFormat: undefined,
      victoriaLogsUrl: 'http://localhost:9428/insert/jsonline',
    });

    expect(options.transports).toHaveLength(2);
    expect(getConsoleLevel(options)).toBe('info');
  });

  it('uses only Console in production when VICTORIALOGS_URL is unset', () => {
    const options = createLoggerOptions({
      nodeEnv: 'production',
      logLevel: '',
      logFormat: undefined,
      victoriaLogsUrl: '',
    });

    expect(options.transports).toHaveLength(1);
  });

  it('honors an explicit log level override', () => {
    const options = createLoggerOptions({
      nodeEnv: 'production',
      logLevel: 'warn',
      logFormat: undefined,
      victoriaLogsUrl: undefined,
    });

    expect(getConsoleLevel(options)).toBe('warn');
  });

  it('uses error level in test mode for minimal output', () => {
    const options = createLoggerOptions({
      nodeEnv: 'test',
      logLevel: '',
      logFormat: undefined,
      victoriaLogsUrl: undefined,
    });

    expect(getConsoleLevel(options)).toBe('error');
  });

  it('falls back to development when nodeEnv is empty', () => {
    // With an empty nodeEnv the factory defaults to 'development' → debug level.
    const options = createLoggerOptions({
      nodeEnv: '',
      logLevel: '',
      logFormat: undefined,
      victoriaLogsUrl: undefined,
    });

    expect(getConsoleLevel(options)).toBe('debug');
  });
});

// ── format selection ─────────────────────────────────────────────────────

describe('format selection', () => {
  it('uses pretty (non-JSON) format in development', async () => {
    const capture = createCapturingLogger('development', 'silly', {
      logFormat: '',
    });

    await logAndFlush(capture, 'hello world');

    expect(() => {
      JSON.parse(capture.lines[0]!);
    }).toThrow();
    expect(capture.lines[0]).toContain('hello world');
  });

  it('uses JSON format in test', async () => {
    const capture = createCapturingLogger('test', 'silly', { logFormat: '' });

    await logAndFlush(capture, 'hello');

    const entry = JSON.parse(capture.lines[0]!) as Record<string, unknown>;
    expect(entry['message']).toBe('hello');
  });

  it('uses JSON format in production', async () => {
    const capture = createCapturingLogger('production', 'silly', {
      logFormat: '',
    });

    await logAndFlush(capture, 'hello');

    const entry = JSON.parse(capture.lines[0]!) as Record<string, unknown>;
    expect(entry['message']).toBe('hello');
  });

  it('LOG_FORMAT=json overrides dev to JSON', async () => {
    const capture = createCapturingLogger('development', 'silly', {
      logFormat: 'json',
    });

    await logAndFlush(capture, 'hello');

    const entry = JSON.parse(capture.lines[0]!) as Record<string, unknown>;
    expect(entry['message']).toBe('hello');
  });

  it('LOG_FORMAT=pretty overrides test to pretty', async () => {
    const capture = createCapturingLogger('test', 'silly', {
      logFormat: 'pretty',
    });

    await logAndFlush(capture, 'hello');

    expect(() => {
      JSON.parse(capture.lines[0]!);
    }).toThrow();
    expect(capture.lines[0]).toContain('hello');
  });

  it('dev format includes timestamp and context', async () => {
    const capture = createCapturingLogger('development', 'silly', {
      logFormat: '',
    });

    await logAndFlush(capture, 'hello');

    // Should match a timestamp pattern like "2026-07-27 14:30:45.123"
    expect(capture.lines[0]).toMatch(
      /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/,
    );
    // Should contain the default context [App]
    expect(capture.lines[0]).toContain('[App]');
  });

  it('dev format shows trace tag when present', async () => {
    const capture = createCapturingLogger('development', 'silly', {
      logFormat: '',
    });

    mockSpanContext = {
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: 'fedcba9876543210',
    };
    await logAndFlush(capture, 'hello');

    // Should contain the trace id (first 8 chars) and span id (first 8 chars)
    // in a [trace=xxxxxxxx:yyyyyyyy] tag
    expect(capture.lines[0]).toContain('[trace=01234567:fedcba98]');
  });

  it('dev format omits the span suffix when span id is absent', async () => {
    const capture = createCapturingLogger('development', 'silly', {
      logFormat: '',
    });

    mockSpanContext = {
      traceId: '0123456789abcdef0123456789abcdef',
    };
    await logAndFlush(capture, 'hello');

    // No span id available → the tag stays [trace=xxxxxxxx] without a colon part
    expect(capture.lines[0]).toContain('[trace=01234567]');
    expect(capture.lines[0]).not.toContain('[trace=01234567:');
  });

  it('JSON format includes timestamp field', async () => {
    const capture = createCapturingLogger('production', 'silly', {
      logFormat: '',
    });

    await logAndFlush(capture, 'hello');

    const entry = JSON.parse(capture.lines[0]!) as Record<string, unknown>;
    expect(entry['timestamp']).toBeDefined();
  });
});

// ── OTel trace injection (requires JSON format for parse assertions) ─────

describe('otel trace format', () => {
  // Uses 'test' env → JSON format, so JSON.parse assertions are valid.
  function createTestLogger() {
    return createCapturingLogger('test', 'silly');
  }

  it('injects the active span ids as top-level JSON fields', async () => {
    const capture = createTestLogger();

    mockSpanContext = {
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: 'fedcba9876543210',
    };
    await logAndFlush(capture, 'hello');

    expect(capture.lines).toHaveLength(1);
    const entry = JSON.parse(capture.lines[0]!) as Record<string, unknown>;
    expect(entry['trace_id']).toBe('0123456789abcdef0123456789abcdef');
    expect(entry['span_id']).toBe('fedcba9876543210');
    expect(entry['message']).toBe('hello');
  });

  it('adds no trace ids outside a span', async () => {
    const capture = createTestLogger();

    await logAndFlush(capture, 'hello');

    const entry = JSON.parse(capture.lines[0]!) as Record<string, unknown>;
    expect(entry).not.toHaveProperty('trace_id');
    expect(entry).not.toHaveProperty('span_id');
  });

  it('keeps explicitly provided trace ids over the span ones', async () => {
    const capture = createTestLogger();

    mockSpanContext = {
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: 'fedcba9876543210',
    };
    await logAndFlush(capture, 'hello', { trace_id: 'explicit-trace' });

    const entry = JSON.parse(capture.lines[0]!) as Record<string, unknown>;
    expect(entry['trace_id']).toBe('explicit-trace');
  });
});
