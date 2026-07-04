import { createLoggerOptions } from './logger.config';
import type { Options } from 'pino-http';

function getPinoHttpOptions(nodeEnv: string, logLevel: string): Options {
  return createLoggerOptions(nodeEnv, logLevel).pinoHttp as Options;
}

describe('createLoggerOptions', () => {
  it('uses pino-pretty transport in development', () => {
    const options = getPinoHttpOptions('development', '');

    expect(options.transport).toEqual(
      expect.objectContaining({
        target: 'pino-pretty',
      }),
    );
    expect(options.level).toBe('debug');
  });

  it('uses json logging without pretty transport in production', () => {
    const options = getPinoHttpOptions('production', '');

    expect(options.transport).toBeUndefined();
    expect(options.level).toBe('info');
  });

  it('honors an explicit log level override', () => {
    const options = getPinoHttpOptions('production', 'warn');

    expect(options.level).toBe('warn');
  });
});
