import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { ApiEnvelope, successEnvelope } from '../api-envelope';

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
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((data: unknown) => {
        if (isApiEnvelope(data)) {
          return data;
        }
        return successEnvelope(data ?? null);
      }),
    );
  }
}
