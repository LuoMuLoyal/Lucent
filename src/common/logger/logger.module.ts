import { Global, Logger, Module } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { ConfigService } from '@nestjs/config';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import { createLoggerOptions } from './logger.config.js';
import { LifecycleService } from './lifecycle.service.js';

@Global()
@Module({
  imports: [
    WinstonModule.forRootAsync({
      imports: [],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const nodeEnv =
          configService.get<string>(EnvKey.NODE_ENV) ?? 'development';
        const logLevel = configService.get<string>(EnvKey.LOG_LEVEL);
        const logFormat = configService.get<string>(EnvKey.LOG_FORMAT) ?? '';
        const victoriaLogsUrl =
          configService.get<string>(EnvKey.VICTORIALOGS_URL) ?? '';
        // Inject a NestJS Logger for VictoriaLogs transport warnings so
        // ingest errors never hit console.error (ADR-0012: no console.*
        // in application code).
        const victoriaLogger = new Logger('VictoriaLogsTransport');
        return createLoggerOptions({
          nodeEnv,
          logLevel,
          logFormat,
          victoriaLogsUrl,
          fallbackLogger: (msg: string) => {
            victoriaLogger.warn(msg);
          },
        });
      },
    }),
  ],
  providers: [LifecycleService],
  exports: [WinstonModule],
})
export class LoggerModule {}
