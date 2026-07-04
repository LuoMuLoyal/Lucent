import type { Params } from 'nestjs-pino';
import type { Options } from 'pino-http';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { RequestWithId } from '../middleware/request-id.middleware';

function createPinoHttpOptions(nodeEnv: string, logLevel: string): Options {
  const isProduction = nodeEnv === 'production';
  const level = logLevel || (isProduction ? 'info' : 'debug');

  return {
    level,
    ...(isProduction
      ? {}
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
          requestUrl.startsWith('/api/docs')
        );
      },
    },
    customSuccessMessage: (request, response) => {
      const requestMethod = request.method ?? '';
      const requestUrl = request.url ?? '';
      return `${requestMethod} ${requestUrl} completed with ${String(response.statusCode)}`;
    },
    customErrorMessage: (request, response) => {
      const requestMethod = request.method ?? '';
      const requestUrl = request.url ?? '';
      return `${requestMethod} ${requestUrl} failed with ${String(response.statusCode)}`;
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
