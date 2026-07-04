import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ResultCode, errorEnvelope } from '../api-envelope';

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
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = this.resolveStatus(exception);
    const body = this.resolveBody(exception, status);

    response.status(status).json(errorEnvelope(body.code, body.message));
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
