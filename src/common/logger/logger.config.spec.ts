import { Writable } from 'node:stream';
import { createLogger, transports as winstonTransports } from 'winston';
import { createLoggerOptions } from './logger.config';
import { requestContextStorage } from './request-context.service';
import type { WinstonModuleOptions } from 'nest-winston';

interface LeveledTransport {
  level: string;
}

function getConsoleLevel(options: WinstonModuleOptions): string {
  const transports = options.transports;
  const arr = Array.isArray(transports) ? transports : [transports];
  return (arr[0] as unknown as LeveledTransport).level;
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

describe('requestId format', () => {
  function createCapturingLogger() {
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
    const options = createLoggerOptions('test', 'silly');
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

  it('injects the active requestId as a top-level JSON field', async () => {
    const capture = createCapturingLogger();

    await logAndFlush(capture, 'hello', undefined, 'req-42');

    expect(capture.lines).toHaveLength(1);
    const entry = JSON.parse(capture.lines[0]!) as Record<string, unknown>;
    expect(entry['requestId']).toBe('req-42');
    expect(entry['message']).toBe('hello');
  });

  it('adds no requestId outside a request context', async () => {
    const capture = createCapturingLogger();

    await logAndFlush(capture, 'hello');

    const entry = JSON.parse(capture.lines[0]!) as Record<string, unknown>;
    expect(entry).not.toHaveProperty('requestId');
  });

  it('keeps an explicitly provided requestId over the context one', async () => {
    const capture = createCapturingLogger();

    await logAndFlush(capture, 'hello', { requestId: 'explicit' }, 'ctx-id');

    const entry = JSON.parse(capture.lines[0]!) as Record<string, unknown>;
    expect(entry['requestId']).toBe('explicit');
  });
});
