import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  type HealthComponentStatus,
  type HealthOverallStatus,
  type HealthProbeDto,
  type HealthProbeType,
} from './app.dto';
import { EnvKey } from './config/env/env-keys.enum';
import { PrismaService } from './prisma';
import { nowIsoString } from './common';
import { extractErrorInfo } from './common';

type HealthComponent = HealthProbeDto['components'][number];

/** TTL (ms) for the health-check cache probe key. */
const PROBE_TTL_MS = 5_000;

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

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
      checkedAt: nowIsoString(),
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
      await this.prisma.$queryRaw`SELECT 1`;
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
      const { message: reason, stack } = extractErrorInfo(error);
      this.logger.error(`Database health probe failed: ${reason}`, stack);
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
      await this.cache.set(probeKey, 'ok', PROBE_TTL_MS);
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
      const { message: reason, stack } = extractErrorInfo(error);
      this.logger.error(`Cache health probe failed: ${reason}`, stack);
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
}
