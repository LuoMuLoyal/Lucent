import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  Optional,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../config/runtime/runtime-config.types.js';
import { Observable, tap } from 'rxjs';
import { performance } from 'node:perf_hooks';
import type { FastifyRequest } from 'fastify';

export const SKIP_SLOW_REQUEST_KEY = 'skipSlowRequestLog';

/**
 * Measures handler execution time and emits a `warn` log when the elapsed
 * duration exceeds the configured threshold (`SLOW_REQUEST_THRESHOLD_MS`).
 *
 * Registered as a global interceptor in `setupApp`.
 */
@Injectable()
export class SlowRequestInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SlowRequestInterceptor.name);

  private readonly envThreshold: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    @Optional()
    @Inject(RuntimeConfigService)
    private readonly runtimeConfig?: RuntimeConfigPort,
  ) {
    this.envThreshold = Number(
      this.configService.get<string>(EnvKey.SLOW_REQUEST_THRESHOLD_MS),
    );
  }

  /**
   * Threshold resolved per request: a published change applies to requests
   * that start afterwards. No per-request allocation beyond the snapshot read.
   */
  private get threshold(): number {
    return (
      this.runtimeConfig?.getSnapshot().values[
        EnvKey.SLOW_REQUEST_THRESHOLD_MS
      ] ?? this.envThreshold
    );
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.shouldSkip(context)) {
      return next.handle();
    }

    const start = performance.now();
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const handlerName = context.getClass().name;
    const method = request.method;
    const path = request.url;

    return next.handle().pipe(
      tap(() => {
        const durationMs = performance.now() - start;

        if (durationMs >= this.threshold) {
          this.logger.warn(
            `Slow request: ${method} ${path} took ${durationMs.toFixed(0)}ms (threshold ${String(this.threshold)}ms) [handler=${handlerName}, durationMs=${String(Number(durationMs.toFixed(2)))}]`,
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
