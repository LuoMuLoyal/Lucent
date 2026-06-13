import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  type HealthComponentStatus,
  type HealthOverallStatus,
  type HealthProbeDto,
  type HealthProbeType,
} from './app.dto';
import { EnvKey } from './config/env-keys.enum';
import { PrismaService } from './prisma/prisma.service';

type HealthComponent = HealthProbeDto['components'][number];

@Injectable()
export class AppService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async getHealth(): Promise<HealthProbeDto> {
    return this.getReadyHealth();
  }

  getLiveHealth(): HealthProbeDto {
    return this.buildProbe('live', []);
  }

  async getReadyHealth(): Promise<HealthProbeDto> {
    const components = await Promise.all([
      this.probeDatabase(false),
      this.probeCache(false),
    ]);

    return this.buildProbe('ready', components);
  }

  async getDeepHealth(): Promise<HealthProbeDto> {
    const components = await Promise.all([
      this.probeDatabase(true),
      this.probeCache(true),
    ]);

    return this.buildProbe('deep', components);
  }

  async getMetrics(): Promise<string> {
    const readyProbe = await this.getReadyHealth();
    const app = readyProbe.app;
    const lines = [
      '# HELP lucent_build_info Static information about the Lucent process.',
      '# TYPE lucent_build_info gauge',
      `lucent_build_info{service="lucent",env="${this.escapeLabelValue(app.env)}"} 1`,
      '# HELP lucent_process_uptime_seconds Uptime of the Lucent process in seconds.',
      '# TYPE lucent_process_uptime_seconds gauge',
      `lucent_process_uptime_seconds ${app.uptimeSeconds.toFixed(3)}`,
      '# HELP lucent_process_resident_memory_bytes Resident memory usage in bytes.',
      '# TYPE lucent_process_resident_memory_bytes gauge',
      `lucent_process_resident_memory_bytes ${String(app.memoryRssBytes)}`,
      '# HELP lucent_process_heap_used_bytes V8 heap memory in use in bytes.',
      '# TYPE lucent_process_heap_used_bytes gauge',
      `lucent_process_heap_used_bytes ${String(app.memoryHeapUsedBytes)}`,
      '# HELP lucent_health_status Current Lucent health status by probe.',
      '# TYPE lucent_health_status gauge',
      `lucent_health_status{probe="ready"} ${readyProbe.status === 'ok' ? '1' : '0'}`,
      '# HELP lucent_dependency_up Dependency availability by component.',
      '# TYPE lucent_dependency_up gauge',
      '# HELP lucent_dependency_probe_duration_milliseconds Dependency probe duration in milliseconds.',
      '# TYPE lucent_dependency_probe_duration_milliseconds gauge',
    ];

    for (const component of readyProbe.components) {
      const backend =
        typeof component.details?.['backend'] === 'string'
          ? component.details['backend']
          : 'n/a';
      const labels = `{dependency="${this.escapeLabelValue(component.name)}",critical="${component.critical ? 'true' : 'false'}",backend="${this.escapeLabelValue(backend)}"}`;
      lines.push(
        `lucent_dependency_up${labels} ${component.status === 'up' ? '1' : '0'}`,
      );
      lines.push(
        `lucent_dependency_probe_duration_milliseconds${labels} ${String(component.durationMs)}`,
      );
    }

    return `${lines.join('\n')}\n`;
  }

  isHealthy(probe: HealthProbeDto): boolean {
    return probe.status === 'ok';
  }

  private buildProbe(
    probe: HealthProbeType,
    components: HealthComponent[],
  ): HealthProbeDto {
    const summary = this.summarize(components);

    return {
      probe,
      status: this.computeOverallStatus(components),
      checkedAt: new Date().toISOString(),
      app: this.getAppInfo(),
      summary,
      components,
    };
  }

  private computeOverallStatus(
    components: HealthComponent[],
  ): HealthOverallStatus {
    const hasCriticalFailure = components.some(
      (component) => component.critical && component.status === 'down',
    );
    return hasCriticalFailure ? 'error' : 'ok';
  }

  private summarize(components: HealthComponent[]): HealthProbeDto['summary'] {
    const passed = components.filter(
      (component) => component.status === 'up',
    ).length;
    const failed = components.length - passed;

    return {
      total: components.length,
      passed,
      failed,
    };
  }

  private getAppInfo(): HealthProbeDto['app'] {
    const memoryUsage = process.memoryUsage();

    return {
      name: 'lucent',
      env: this.configService.get<string>(EnvKey.NODE_ENV) ?? 'development',
      pid: process.pid,
      uptimeSeconds: Number(process.uptime().toFixed(3)),
      memoryRssBytes: memoryUsage.rss,
      memoryHeapUsedBytes: memoryUsage.heapUsed,
    };
  }

  private async probeDatabase(
    includeDetails: boolean,
  ): Promise<HealthComponent> {
    const startedAt = Date.now();

    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return this.buildComponent({
        name: 'database',
        status: 'up',
        critical: true,
        startedAt,
        details: includeDetails
          ? {
              driver: 'prisma',
              probe: 'SELECT 1',
            }
          : {
              driver: 'prisma',
            },
      });
    } catch (error) {
      return this.buildComponent({
        name: 'database',
        status: 'down',
        critical: true,
        startedAt,
        error,
        details: includeDetails
          ? {
              driver: 'prisma',
              probe: 'SELECT 1',
            }
          : {
              driver: 'prisma',
            },
      });
    }
  }

  private async probeCache(includeDetails: boolean): Promise<HealthComponent> {
    const startedAt = Date.now();
    const redisUrl = this.configService.get<string>(EnvKey.REDIS_URL);
    const backend = redisUrl ? 'redis' : 'memory';

    if (!redisUrl) {
      return this.buildComponent({
        name: 'cache',
        status: 'up',
        critical: false,
        startedAt,
        details: includeDetails
          ? {
              backend,
              mode: 'fallback',
            }
          : {
              backend,
            },
      });
    }

    const probeKey = `health:probe:${randomUUID()}`;

    try {
      await this.cache.set(probeKey, 'ok', 5_000);
      const value = await this.cache.get<string>(probeKey);
      await this.cache.del(probeKey);

      if (value !== 'ok') {
        throw new Error('Cache round-trip returned an unexpected value');
      }

      return this.buildComponent({
        name: 'cache',
        status: 'up',
        critical: true,
        startedAt,
        details: includeDetails
          ? {
              backend,
              probe: 'set/get/del',
            }
          : {
              backend,
            },
      });
    } catch (error) {
      return this.buildComponent({
        name: 'cache',
        status: 'down',
        critical: true,
        startedAt,
        error,
        details: includeDetails
          ? {
              backend,
              probe: 'set/get/del',
            }
          : {
              backend,
            },
      });
    }
  }

  private buildComponent(input: {
    name: string;
    status: HealthComponentStatus;
    critical: boolean;
    startedAt: number;
    details?: Record<string, unknown>;
    error?: unknown;
  }): HealthComponent {
    return {
      name: input.name,
      status: input.status,
      critical: input.critical,
      durationMs: Date.now() - input.startedAt,
      error: input.error === undefined ? null : this.formatError(input.error),
      details: input.details ?? null,
    };
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private escapeLabelValue(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/"/g, '\\"');
  }
}
