import { Global, Logger, Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import { createPinoParams } from './logger.config.js';
import { LifecycleService } from './lifecycle.service.js';
import { RuntimeLogLevelService } from './runtime-log-level.service.js';

/**
 * Wires `nestjs-pino` as the application logger.
 *
 * `LoggerModule.forRootAsync` registers the `Logger` / `PinoLogger` providers;
 * `main.ts` then substitutes it via `app.useLogger(app.get(Logger))`, so every
 * `new Logger(X.name)` in the codebase emits through pino without changing its
 * construction site.
 *
 * Global so feature modules can inject `PinoLogger` where the structured API is
 * genuinely needed (currently only the runtime log-level switch).
 */
@Global()
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const nodeEnv =
          configService.get<string>(EnvKey.NODE_ENV) ?? 'development';
        const logLevel = configService.get<string>(EnvKey.LOG_LEVEL);
        const logFormat = configService.get<string>(EnvKey.LOG_FORMAT) ?? '';
        const victoriaLogsUrl =
          configService.get<string>(EnvKey.VICTORIALOGS_URL) ?? '';
        // Route ingest warnings through the application logger instead of
        // console.* (ADR-0012: never swallow a failure silently).
        const ingestLogger = new Logger('VictoriaLogsIngest');
        return createPinoParams({
          nodeEnv,
          logLevel,
          logFormat,
          victoriaLogsUrl,
          onWarn: (message: string) => {
            ingestLogger.warn(message);
          },
        });
      },
    }),
  ],
  providers: [LifecycleService, RuntimeLogLevelService],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
