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
 * 三条路径语义严格分离：
 *
 * | 路径 | 查什么 | 依赖挂掉时 | 用途 |
 * |---|---|---|---|
 * | `/health/live` | 只测进程 | 仍 200 | 容器存活探针 |
 * | `/health/ready` | 进程 + database + cache | 503 | 就绪探针 |
 * | `/health/deep` | 同 ready，带逐组件诊断 | 503 | 人工排查 |
 *
 * 存活探针不得查依赖：容器健康与否只取决于进程是否运行。依赖故障属于就绪问题，
 * 由 `/health/ready` 表达，否则一次下游抖动会引发容器重启。
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
