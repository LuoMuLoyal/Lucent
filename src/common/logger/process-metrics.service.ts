import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { EnvKey } from '../../config/env-keys.enum';
import { DEFAULT_METRICS_LOG_INTERVAL_MS } from '../../config/constants';

/**
 * Periodically logs process-level metrics (memory, uptime, active handles)
 * so production deployments have a heartbeat without relying on external
 * health-check polling.
 *
 * Skipped in the `test` environment to avoid stray timers in Jest.
 */
@Injectable()
export class ProcessMetricsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private intervalId: NodeJS.Timeout | undefined;

  constructor(
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService,
  ) {
    this.logger.setContext(ProcessMetricsService.name);
  }

  onApplicationBootstrap(): void {
    const env =
      this.configService.get<string>(EnvKey.NODE_ENV) ?? 'development';
    if (env === 'test') {
      return;
    }

    const intervalMs =
      this.configService.get<number>(EnvKey.METRICS_LOG_INTERVAL_MS) ??
      DEFAULT_METRICS_LOG_INTERVAL_MS;

    this.intervalId = setInterval(() => {
      this.logMetrics();
    }, intervalMs);
    // Unref so the timer doesn't keep the process alive on its own.
    this.intervalId.unref();
  }

  onApplicationShutdown(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  private logMetrics(): void {
    const mem = process.memoryUsage();
    this.logger.info(
      {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        uptimeSeconds: Number(process.uptime().toFixed(3)),
        activeHandles: this.getActiveHandleCount(),
      },
      'Process metrics',
    );
  }

  private getActiveHandleCount(): number {
    try {
      const processWithHandles = process as unknown as {
        _getActiveHandles?: () => unknown[];
      };
      const handles = processWithHandles._getActiveHandles?.() ?? [];
      return handles.length;
    } catch {
      return 0;
    }
  }
}
