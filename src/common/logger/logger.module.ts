import { Global, Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { EnvKey } from '../../config/env-keys.enum';
import { createLoggerOptions } from './logger.config';
import { LifecycleService } from './lifecycle.service';
import { RequestContextService } from './request-context.service';

@Global()
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      useFactory: () => {
        const nodeEnv = process.env[EnvKey.NODE_ENV] ?? 'development';
        const logLevel = process.env[EnvKey.LOG_LEVEL] ?? '';
        return createLoggerOptions(nodeEnv, logLevel);
      },
    }),
  ],
  providers: [RequestContextService, LifecycleService],
  exports: [PinoLoggerModule, RequestContextService],
})
export class LoggerModule {}
