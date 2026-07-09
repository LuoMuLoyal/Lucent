import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { Observable, tap } from 'rxjs';
import { performance } from 'node:perf_hooks';
import type { Request } from 'express';
import { EnvKey } from '../../config/env-keys.enum';
import { DEFAULT_SLOW_REQUEST_THRESHOLD_MS } from '../../config/constants';

export const SKIP_SLOW_REQUEST_KEY = 'skipSlowRequestLog';

/**
 * Measures handler execution time and emits a `warn` log when the elapsed
 * duration exceeds the configured threshold (`SLOW_REQUEST_THRESHOLD_MS`).
 *
 * Registered as a global interceptor in `setupApp`.
 */
@Injectable()
export class SlowRequestInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {
    this.logger.setContext(SlowRequestInterceptor.name);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.shouldSkip(context)) {
      return next.handle();
    }

    const start = performance.now();
    const request = context.switchToHttp().getRequest<Request>();
    const handlerName = context.getClass().name;
    const method = request.method;
    const path = request.originalUrl || request.url;

    return next.handle().pipe(
      tap(() => {
        const durationMs = performance.now() - start;
        const threshold =
          this.configService.get<number>(EnvKey.SLOW_REQUEST_THRESHOLD_MS) ??
          DEFAULT_SLOW_REQUEST_THRESHOLD_MS;

        if (durationMs >= threshold) {
          this.logger.warn(
            {
              method,
              path,
              durationMs: Number(durationMs.toFixed(2)),
              threshold,
              handler: handlerName,
            },
            `Slow request: ${method} ${path} took ${durationMs.toFixed(0)}ms (threshold ${String(threshold)}ms)`,
          );
        }
      }),
    );
  }

  private shouldSkip(context: ExecutionContext): boolean {
    return this.reflector.getAllAndOverride<boolean>(SKIP_SLOW_REQUEST_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  }
}
