import type { Params } from 'nestjs-pino';
import type { Options } from 'pino-http';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { RequestWithId } from '../middleware/request-id.middleware';

/**
 * Formats a response-time suffix string (e.g. ` in 42ms`) for inclusion
 * in HTTP request log messages.
 */
function formatDurationSuffix(responseTime: number): string {
  if (responseTime < 0) {
    return '';
  }
  return ` in ${responseTime.toFixed(0)}ms`;
}

function createPinoHttpOptions(nodeEnv: string, logLevel: string): Options {
  const isProduction = nodeEnv === 'production';
  const level = logLevel || (isProduction ? 'info' : 'debug');

  return {
    level,
    ...(isProduction
      ? {
          transport: {
            targets: [
              {
                target: 'pino/file',
                options: { destination: 1 },
                level,
              },
              {
                target: 'pino-roll',
                options: {
                  file: 'lucent',
                  frequency: 'daily',
                  dir: './logs',
                  mkdir: true,
                  maxSize: 524288000,
                },
                level,
              },
            ],
          },
        }
      : {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              singleLine: true,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          },
        }),
    genReqId: (request) => {
      const existingRequestId = (request as RequestWithId).requestId;
      if (
        typeof existingRequestId === 'string' &&
        existingRequestId.length > 0
      ) {
        return existingRequestId;
      }

      const headerValue = request.headers['x-request-id'];
      if (typeof headerValue === 'string' && headerValue.trim()) {
        return headerValue.trim();
      }

      return randomUUID();
    },
    customLogLevel: (_request, response, error) => {
      if (error || response.statusCode >= 500) {
        return 'error';
      }
      if (response.statusCode >= 400) {
        return 'warn';
      }
      return 'info';
    },
    autoLogging: {
      ignore: (request) => {
        const requestUrl = request.url ?? '';
        return (
          requestUrl.startsWith('/api/v1/health') ||
          requestUrl.startsWith('/api/docs') ||
          requestUrl.startsWith('/metrics')
        );
      },
    },
    customSuccessMessage: (request, response, responseTime) => {
      const requestMethod = request.method ?? '';
      const requestUrl = request.url ?? '';
      return `${requestMethod} ${requestUrl} completed ${String(response.statusCode)}${formatDurationSuffix(responseTime)}`;
    },
    customErrorMessage: (request, response, _error) => {
      const requestMethod = request.method ?? '';
      const requestUrl = request.url ?? '';
      return `${requestMethod} ${requestUrl} failed ${String(response.statusCode)}`;
    },
    serializers: {
      req: (request: Request) => ({
        id: (request as RequestWithId).requestId,
        method: request.method,
        url: request.originalUrl || request.url,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      }),
      res: (response: Response) => ({
        statusCode: response.statusCode,
      }),
    },
  };
}

export function createLoggerOptions(nodeEnv: string, logLevel: string): Params {
  return {
    pinoHttp: createPinoHttpOptions(nodeEnv, logLevel),
    renameContext: 'context',
  };
}
