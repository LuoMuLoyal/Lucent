import { Writable } from 'node:stream';
import { createLogger, transports as winstonTransports } from 'winston';
import { createLoggerOptions } from './logger.config';
import { requestContextStorage } from './request-context.service';
import type { WinstonModuleOptions } from 'nest-winston';
import { EnvKey } from '../../config/env-keys.enum';

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
  requestId?: string,
): Promise<void> {
  const written = capture.waitForLine(capture.lines.length + 1);
  const emit = (): void => {
    if (meta) {
      capture.logger.info(message, meta);
    } else {
      capture.logger.info(message);
    }
  };
  if (requestId === undefined) {
    emit();
  } else {
    requestContextStorage.run({ requestId }, emit);
  }
  await written;
}

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

  it('dev format shows requestId tag when present', async () => {
    process.env[EnvKey.LOG_FORMAT] = '';
    const capture = createCapturingLogger('development');

    await logAndFlush(capture, 'hello', undefined, 'req-abc12345');

    // Should contain the requestId (first 8 chars) somewhere in the line
    expect(capture.lines[0]).toContain('req-abc1');
  });

  it('JSON format includes timestamp field', async () => {
    process.env[EnvKey.LOG_FORMAT] = '';
    const capture = createCapturingLogger('production');

    await logAndFlush(capture, 'hello');

    const entry = JSON.parse(capture.lines[0]!) as Record<string, unknown>;
    expect(entry['timestamp']).toBeDefined();
  });
});

// ── requestId injection (requires JSON format for parse assertions) ──────

describe('requestId format', () => {
  // Uses 'test' env → JSON format, so JSON.parse assertions are valid.
  function createTestLogger() {
    return createCapturingLogger('test', 'silly');
  }

  it('injects the active requestId as a top-level JSON field', async () => {
    const capture = createTestLogger();

    await logAndFlush(capture, 'hello', undefined, 'req-42');

    expect(capture.lines).toHaveLength(1);
    const entry = JSON.parse(capture.lines[0]!) as Record<string, unknown>;
    expect(entry['requestId']).toBe('req-42');
    expect(entry['message']).toBe('hello');
  });

  it('adds no requestId outside a request context', async () => {
    const capture = createTestLogger();

    await logAndFlush(capture, 'hello');

    const entry = JSON.parse(capture.lines[0]!) as Record<string, unknown>;
    expect(entry).not.toHaveProperty('requestId');
  });

  it('keeps an explicitly provided requestId over the context one', async () => {
    const capture = createTestLogger();

    await logAndFlush(capture, 'hello', { requestId: 'explicit' }, 'ctx-id');

    const entry = JSON.parse(capture.lines[0]!) as Record<string, unknown>;
    expect(entry['requestId']).toBe('explicit');
  });
});
