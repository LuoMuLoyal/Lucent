import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../config/env/config-keys.enum.js';
import type { YamlConfig } from '../../config/yaml/yaml-loader.js';
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

  private readonly threshold: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {
    const yaml = this.configService.getOrThrow<YamlConfig>(ConfigKey.Yaml);
    this.threshold = yaml.log.slowRequestThresholdMs;
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
