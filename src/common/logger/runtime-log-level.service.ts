import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import type { Logger as WinstonLogger } from 'winston';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../config/runtime/runtime-config.types.js';

/**
 * Applies a published `LOG_LEVEL` to the running Winston transports.
 *
 * The startup level (from `LOG_LEVEL` env or the per-environment default) is
 * the baseline; the ops family's published value overrides it without a
 * restart. Both `logger.level` and every transport's level are set: Winston
 * filters per transport, so changing only the logger's own level would leave
 * the console quiet.
 */
@Injectable()
export class RuntimeLogLevelService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RuntimeLogLevelService.name);
  private unsubscribe: (() => void) | null = null;

  constructor(
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly winston: WinstonLogger,
    @Optional()
    @Inject(RuntimeConfigService)
    private readonly runtimeConfig?: RuntimeConfigPort,
  ) {}

  onModuleInit(): void {
    if (this.runtimeConfig === undefined) {
      return;
    }

    this.apply(this.runtimeConfig.getSnapshot().values[EnvKey.LOG_LEVEL]);
    this.unsubscribe = this.runtimeConfig.subscribe((snapshot) => {
      this.apply(snapshot.values[EnvKey.LOG_LEVEL]);
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private apply(level: string | undefined): void {
    if (level === undefined || level.length === 0) {
      return;
    }

    const transports = this.winston.transports;
    const unchanged =
      this.winston.level === level &&
      transports.every((transport) => transport.level === level);
    if (unchanged) {
      return;
    }

    const previous = this.winston.level;
    this.winston.level = level;
    for (const transport of transports) {
      transport.level = level;
    }
    this.logger.log(`Log level changed: ${previous} -> ${level}`);
  }
}
