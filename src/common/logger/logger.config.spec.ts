import { Writable } from 'node:stream';
import { createLogger, transports as winstonTransports } from 'winston';
import { createLoggerOptions } from './logger.config';
import type { WinstonModuleOptions } from 'nest-winston';
import { EnvKey } from '../../config/env/env-keys.enum';

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
  const options = createLoggerOptions(nodeEnv, level);
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

// ── OTel span mock ────────────────────────────────────────────────
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
    const options = createLoggerOptions('development', '');

    expect(options.transports).toHaveLength(1);
    expect(getConsoleLevel(options)).toBe('debug');
  });

  it('uses info level in production with console + rotate transports', () => {
    const options = createLoggerOptions('production', '');

    expect(options.transports).toHaveLength(2);
    expect(getConsoleLevel(options)).toBe('info');
  });

  it('honors an explicit log level override', () => {
    const options = createLoggerOptions('production', 'warn');

    expect(getConsoleLevel(options)).toBe('warn');
  });

  it('uses error level in test mode for minimal output', () => {
    const options = createLoggerOptions('test', '');

    expect(getConsoleLevel(options)).toBe('error');
  });

  it('falls back to process.env.NODE_ENV when nodeEnv is empty', () => {
    // During tests, process.env.NODE_ENV is 'test', so the level should be 'error'
    const options = createLoggerOptions('', '');

    expect(getConsoleLevel(options)).toBe('error');
  });
});

// ── format selection ─────────────────────────────────────────────────────

describe('format selection', () => {
  const originalLogFormat = process.env[EnvKey.LOG_FORMAT] ?? '';

  afterEach(() => {
    process.env[EnvKey.LOG_FORMAT] = originalLogFormat;
  });

  it('uses pretty (non-JSON) format in development', async () => {
    process.env[EnvKey.LOG_FORMAT] = '';
    const capture = createCapturingLogger('development');

    await logAndFlush(capture, 'hello world');

    expect(() => {
      JSON.parse(capture.lines[0]!);
    }).toThrow();
    expect(capture.lines[0]).toContain('hello world');
  });

  it('uses JSON format in test', async () => {
    process.env[EnvKey.LOG_FORMAT] = '';
    const capture = createCapturingLogger('test');

    await logAndFlush(capture, 'hello');

    const entry = JSON.parse(capture.lines[0]!) as Record<string, unknown>;
    expect(entry['message']).toBe('hello');
  });

  it('uses JSON format in production', async () => {
    process.env[EnvKey.LOG_FORMAT] = '';
    const capture = createCapturingLogger('production');

    await logAndFlush(capture, 'hello');

    const entry = JSON.parse(capture.lines[0]!) as Record<string, unknown>;
    expect(entry['message']).toBe('hello');
  });

  it('LOG_FORMAT=json overrides dev to JSON', async () => {
    process.env[EnvKey.LOG_FORMAT] = 'json';
    const capture = createCapturingLogger('development');

    await logAndFlush(capture, 'hello');

    const entry = JSON.parse(capture.lines[0]!) as Record<string, unknown>;
    expect(entry['message']).toBe('hello');
  });

  it('LOG_FORMAT=pretty overrides test to pretty', async () => {
    process.env[EnvKey.LOG_FORMAT] = 'pretty';
    const capture = createCapturingLogger('test');

    await logAndFlush(capture, 'hello');

    expect(() => {
      JSON.parse(capture.lines[0]!);
    }).toThrow();
    expect(capture.lines[0]).toContain('hello');
  });

  it('dev format includes timestamp and context', async () => {
    process.env[EnvKey.LOG_FORMAT] = '';
    const capture = createCapturingLogger('development');

    await logAndFlush(capture, 'hello');

    // Should match a timestamp pattern like "2026-07-27 14:30:45.123"
    expect(capture.lines[0]).toMatch(
      /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/,
    );
    // Should contain the default context [App]
    expect(capture.lines[0]).toContain('[App]');
  });

  it('dev format shows trace tag when present', async () => {
    process.env[EnvKey.LOG_FORMAT] = '';
    const capture = createCapturingLogger('development');

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
    process.env[EnvKey.LOG_FORMAT] = '';
    const capture = createCapturingLogger('development');

    mockSpanContext = {
      traceId: '0123456789abcdef0123456789abcdef',
    };
    await logAndFlush(capture, 'hello');

    // No span id available → the tag stays [trace=xxxxxxxx] without a colon part
    expect(capture.lines[0]).toContain('[trace=01234567]');
    expect(capture.lines[0]).not.toContain('[trace=01234567:');
  });

  it('JSON format includes timestamp field', async () => {
    process.env[EnvKey.LOG_FORMAT] = '';
    const capture = createCapturingLogger('production');

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
