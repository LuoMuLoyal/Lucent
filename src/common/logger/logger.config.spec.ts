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
