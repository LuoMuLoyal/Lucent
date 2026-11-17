import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  HealthCheckService,
  type HealthCheckResult,
  type HealthIndicatorFunction,
} from '@nestjs/terminus';
import {
  AppInfoHealthIndicator,
  CacheHealthIndicator,
  DatabaseHealthIndicator,
} from './common/index.js';

/**
 * Health-check orchestration built on `@nestjs/terminus`.
 *
 * - `/health` and `/health/ready` run the critical dependency indicators
 *   (`app`, `database`, `cache`) and return 503 when any of them is down.
 * - `/health/live` only reports process info and never depends on downstream
 *   services, so it always answers 200.
 * - `/health/deep` runs the same checks as `ready` with extra probe detail.
 *
 * terminus signals failures by throwing `ServiceUnavailableException` carrying
 * the native `{ status, info, error, details }` body. This app installs a
 * global `ApiExceptionFilter` that would rewrite that body into RFC 9457
 * Problem Details, so the orchestrator unwraps the exception back into the
 * plain result and lets the controller choose the HTTP status from
 * `isHealthy()`.
 */
@Injectable()
export class AppService {
  constructor(
    private readonly healthCheckService: HealthCheckService,
    private readonly appInfo: AppInfoHealthIndicator,
    private readonly database: DatabaseHealthIndicator,
    private readonly cache: CacheHealthIndicator,
  ) {}

  getHealth(): Promise<HealthCheckResult> {
    return this.getReadyHealth();
  }

  getLiveHealth(): Promise<HealthCheckResult> {
    return this.run([() => this.appInfo.info()]);
  }

  getReadyHealth(): Promise<HealthCheckResult> {
    return this.run([
      () => this.appInfo.info(),
      () => this.database.ping({ verbose: false }),
      () => this.cache.ping({ verbose: false }),
    ]);
  }

  getDeepHealth(): Promise<HealthCheckResult> {
    return this.run([
      () => this.appInfo.info(),
      () => this.database.ping({ verbose: true }),
      () => this.cache.ping({ verbose: true }),
    ]);
  }

  isHealthy(result: HealthCheckResult): boolean {
    return result.status === 'ok';
  }

  private async run(
    indicators: HealthIndicatorFunction[],
  ): Promise<HealthCheckResult> {
    try {
      return await this.healthCheckService.check(indicators);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        return error.getResponse() as HealthCheckResult;
      }
      throw error;
    }
  }
}
