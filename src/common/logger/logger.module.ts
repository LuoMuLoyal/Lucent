import { Global, Module } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../config/env/config-keys.enum';
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
        const nodeEnv = process.env['NODE_ENV'] ?? 'development';
        // env var still wins over YAML default
        const envLogLevel = process.env['LOG_LEVEL'];
        const logLevel = envLogLevel ?? yaml.log.level;
        const logFormat = yaml.log.format;
        return createLoggerOptions(nodeEnv, logLevel, logFormat);
      },
    }),
  ],
  providers: [LifecycleService],
  exports: [WinstonModule],
})
export class LoggerModule {}
