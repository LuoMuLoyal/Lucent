import { Injectable, Logger } from '@nestjs/common';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { extractErrorInfo } from '../helpers/errors/error-info.utils.js';
import { PrismaService } from '../../prisma/index.js';

/**
 * Database (Prisma/PostgreSQL) health indicator for the terminus health check.
 *
 * Wraps the former `AppService.probeDatabase()` `SELECT 1` check. When
 * `verbose` is set (`/health/deep`) the result also carries the executed probe
 * statement; otherwise only the stable `driver` / `durationMs` diagnostics are
 * emitted.
 */
@Injectable()
export class DatabaseHealthIndicator {
  private readonly logger = new Logger(DatabaseHealthIndicator.name);

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly prisma: PrismaService,
  ) {}

  async ping(options: { verbose: boolean }): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check('database');
    const startedAt = Date.now();

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return indicator.up({
        driver: 'prisma',
        ...(options.verbose ? { probe: 'SELECT 1' } : {}),
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const { message: reason, stack } = extractErrorInfo(error);
      this.logger.error(`Database health probe failed: ${reason}`, stack);
      return indicator.down({
        message: reason,
        driver: 'prisma',
        ...(options.verbose ? { probe: 'SELECT 1' } : {}),
        durationMs: Date.now() - startedAt,
      });
    }
  }
}
