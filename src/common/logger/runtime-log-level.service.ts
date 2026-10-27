import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { Logger as PinoInstance } from 'pino';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../config/runtime/runtime-config.types.js';
import { isLogLevel, toPinoLevel, type LogLevel } from './logger.config.js';

/**
 * Applies a published `LOG_LEVEL` to the running pino logger.
 *
 * The startup level (from `LOG_LEVEL` env or the per-environment default) is
 * the baseline; the ops family's published value overrides it without a
 * restart. Pino reads `logger.level` on every call, so assigning the root level
 * re-gates the whole tree — child loggers included.
 */
@Injectable()
export class RuntimeLogLevelService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RuntimeLogLevelService.name);
  private unsubscribe: (() => void) | null = null;
  private current: LogLevel | null = null;

  constructor(
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

  /** Current application-level verbosity (for tests and ops readouts). */
  get levelName(): LogLevel | null {
    return this.current;
  }

  private apply(level: string | undefined): void {
    if (level === undefined || level.length === 0) {
      return;
    }
    // The ops schema already restricts publishes to this vocabulary; a stray
    // value (older snapshot, manual write) must not silently disable logging.
    if (!isLogLevel(level) || this.current === level) {
      return;
    }

    const previous = this.current;
    this.current = level;

    // `PinoLogger.root` is assigned when `nestjs-pino`'s module initialises.
    // The type declares it non-null, but this hook runs during bootstrap, so a
    // mis-ordered module graph would otherwise crash the process here.
    const root = PinoLogger.root as unknown as PinoInstance | undefined;
    if (root === undefined) {
      return;
    }
    root.level = toPinoLevel(level);

    this.logger.log(`Log level changed: ${previous ?? 'startup'} -> ${level}`);
  }
}
