import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { ApiEnvelope, successEnvelope } from '../api-envelope';
import { SKIP_API_ENVELOPE_KEY } from './skip-api-envelope.decorator';

function isApiEnvelope(value: unknown): value is ApiEnvelope {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const maybeEnvelope = value as Partial<ApiEnvelope>;
  return (
    typeof maybeEnvelope.code === 'number' &&
    typeof maybeEnvelope.message === 'string' &&
    'data' in maybeEnvelope
  );
}

@Injectable()
export class ApiEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.shouldSkipEnvelope(context)) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data: unknown) => {
        if (isApiEnvelope(data)) {
          return data;
        }
        return successEnvelope(data ?? null);
      }),
    );
  }

  private shouldSkipEnvelope(context: ExecutionContext): boolean {
    return (
      Reflect.getMetadata(SKIP_API_ENVELOPE_KEY, context.getHandler()) ===
        true ||
      Reflect.getMetadata(SKIP_API_ENVELOPE_KEY, context.getClass()) === true
    );
  }
}
