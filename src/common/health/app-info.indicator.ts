import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { EnvKey } from '../../config/env/env-keys.enum.js';

/**
 * Process-level application info indicator. Always `up`; uses the terminus
 * response body to surface the same `app` diagnostics the former
 * `AppService.getAppInfo()` returned.
 */
@Injectable()
export class AppInfoHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly configService: ConfigService,
  ) {}

  info(): HealthIndicatorResult {
    const memoryUsage = process.memoryUsage();

    return this.healthIndicatorService.check('app').up({
      name: 'lucent',
      env: this.configService.get<string>(EnvKey.NODE_ENV) ?? 'development',
      pid: process.pid,
      uptimeSeconds: Number(process.uptime().toFixed(3)),
      memoryRssBytes: memoryUsage.rss,
      memoryHeapUsedBytes: memoryUsage.heapUsed,
    });
  }
}
