import { createLoggerOptions } from './logger.config';
import type { Options } from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'node:http';

function getPinoHttpOptions(nodeEnv: string, logLevel: string): Options {
  return createLoggerOptions(nodeEnv, logLevel).pinoHttp as Options;
}

/** Creates a minimal mock `IncomingMessage` for pino-http callbacks. */
function createMockRequest(method: string, url: string): IncomingMessage {
  return { method, url } as unknown as IncomingMessage;
}

/** Creates a minimal mock `ServerResponse`. */
function createMockResponse(statusCode: number): ServerResponse {
  return { statusCode } as unknown as ServerResponse;
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

  it('uses dual-write transport (stdout + pino-roll) in production', () => {
    const options = getPinoHttpOptions('production', '');

    expect(options.transport).toEqual(
      expect.objectContaining({
        targets: expect.arrayContaining([
          expect.objectContaining({
            target: 'pino/file',
            options: expect.objectContaining({ destination: 1 }),
          }),
          expect.objectContaining({
            target: 'pino-roll',
            options: expect.objectContaining({
              file: 'lucent',
              frequency: 'daily',
              dir: './logs',
              mkdir: true,
            }),
          }),
        ]),
      }),
    );
    expect(options.level).toBe('info');
  });

  it('honors an explicit log level override', () => {
    const options = getPinoHttpOptions('production', 'warn');

    expect(options.level).toBe('warn');
  });

  it('customSuccessMessage includes response time', () => {
    const options = getPinoHttpOptions('production', '');
    const req = createMockRequest('GET', '/api/v1/health');
    const res = createMockResponse(200);

    const message = options.customSuccessMessage!(req, res, 42);

    expect(message).toBe('GET /api/v1/health completed 200 in 42ms');
  });

  it('customSuccessMessage formats zero response time', () => {
    const options = getPinoHttpOptions('production', '');
    const req = createMockRequest('POST', '/api/v1/login');
    const res = createMockResponse(201);

    const message = options.customSuccessMessage!(req, res, 0);

    expect(message).toBe('POST /api/v1/login completed 201 in 0ms');
  });

  it('customErrorMessage includes 4xx status code', () => {
    const options = getPinoHttpOptions('production', '');
    const req = createMockRequest('GET', '/api/v1/forbidden');
    const res = createMockResponse(403);
    const error = new Error('Forbidden');

    const message = options.customErrorMessage!(req, res, error);

    expect(message).toBe('GET /api/v1/forbidden failed 403');
  });

  it('customErrorMessage includes 5xx status code', () => {
    const options = getPinoHttpOptions('production', '');
    const req = createMockRequest('POST', '/api/v1/data');
    const res = createMockResponse(502);
    const error = new Error('Bad gateway');

    const message = options.customErrorMessage!(req, res, error);

    expect(message).toBe('POST /api/v1/data failed 502');
  });
});
