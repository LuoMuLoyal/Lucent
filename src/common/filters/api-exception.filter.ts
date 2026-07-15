import {
  ArgumentsHost,
  Catch,
  Injectable,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { ResultCode, errorEnvelope } from '../api/api-envelope';
import { RequestContextService } from '../logger/request-context.service';

interface ErrorResponseBody {
  code?: string | number;
  message?: string | string[];
  error?: string;
}

/**
 * Global exception filter that converts any thrown error into the standard
 * `{ code, message, data }` response envelope.
 */
@Catch()
@Injectable()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  constructor(private readonly requestContextService: RequestContextService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const status = this.resolveStatus(exception);
    const body = this.resolveBody(exception, status);

    this.logException(exception, request, status, body.message);

    response.status(status).send(errorEnvelope(body.code, body.message));
  }

  private logException(
    exception: unknown,
    request: FastifyRequest,
    status: HttpStatus,
    message: string,
  ): void {
    const requestId = this.requestContextService.getRequestId();
    const requestIdSuffix = requestId ? ` [reqId=${requestId}]` : '';
    const path = request.url;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Unhandled exception: ${message} [${request.method} ${path} ${String(status)}]${requestIdSuffix}`,
        exception instanceof Error ? exception.stack : undefined,
      );
      return;
    }

    this.logger.warn(
      `Handled exception: ${message} [${request.method} ${path} ${String(status)}]${requestIdSuffix}`,
    );
  }

  private resolveStatus(exception: unknown): HttpStatus {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveBody(
    exception: unknown,
    status: HttpStatus,
  ): { code: ResultCode; message: string } {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'string') {
        return {
          code: this.defaultCode(status),
          message: response,
        };
      }

      const body = response as ErrorResponseBody;
      if (typeof body.code === 'number') {
        return {
          code: body.code,
          message: this.normalizeMessage(body.message ?? body.error),
        };
      }

      return {
        code: this.defaultCode(status),
        message: this.normalizeMessage(body.message ?? body.error),
      };
    }

    return {
      code: ResultCode.INTERNAL_ERROR,
      message: 'Internal server error',
    };
  }

  private defaultCode(status: HttpStatus): ResultCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ResultCode.BAD_REQUEST;
      case HttpStatus.UNAUTHORIZED:
        return ResultCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ResultCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ResultCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ResultCode.CONFLICT;
      default:
        return ResultCode.INTERNAL_ERROR;
    }
  }

  private normalizeMessage(message: string | string[] | undefined): string {
    if (Array.isArray(message)) {
      return message.join('; ');
    }
    return message ?? 'Request failed';
  }
}
