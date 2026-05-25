import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { errorEnvelope } from '../api-envelope';

interface ErrorResponseBody {
  code?: string;
  message?: string | string[];
  error?: string;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = this.resolveStatus(exception);
    const body = this.resolveBody(exception, status);

    response.status(status).json(errorEnvelope(body.code, body.message));
  }

  private resolveStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveBody(
    exception: unknown,
    status: number,
  ): { code: string; message: string } {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'string') {
        return {
          code: this.defaultCode(status),
          message: response,
        };
      }

      const body = response as ErrorResponseBody;
      return {
        code: body.code ?? this.defaultCode(status),
        message: this.normalizeMessage(body.message ?? body.error),
      };
    }

    return {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    };
  }

  private defaultCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'COMMON_BAD_REQUEST';
      case HttpStatus.UNAUTHORIZED:
        return 'AUTH_UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'AUTH_FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'COMMON_NOT_FOUND';
      default:
        return `HTTP_${status}`;
    }
  }

  private normalizeMessage(message: string | string[] | undefined): string {
    if (Array.isArray(message)) {
      return message.join('; ');
    }
    return message ?? 'Request failed';
  }
}
