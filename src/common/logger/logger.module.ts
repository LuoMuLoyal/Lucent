import { Global, Logger, Module } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../config/env/config-keys.enum';
import { EnvKey } from '../../config/env/env-keys.enum';
import type { YamlConfig } from '../../config/yaml/yaml-loader';
import { createLoggerOptions } from './logger.config';
import { LifecycleService } from './lifecycle.service';

@Global()
@Module({
  imports: [
    WinstonModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const yaml = configService.getOrThrow<YamlConfig>(ConfigKey.Yaml);
        // Environment variables take priority over YAML defaults per
        // ADR-0015: env var > .env > config/<env>.yaml > config/default.yaml.
        const nodeEnv =
          configService.get<string>(EnvKey.NODE_ENV) ?? 'development';
        const logLevel = configService.get<string>(EnvKey.LOG_LEVEL);
        const logFormat =
          configService.get<string>(EnvKey.LOG_FORMAT) ?? yaml.log.format;
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
