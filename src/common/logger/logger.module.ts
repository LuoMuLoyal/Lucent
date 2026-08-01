import { Global, Module } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { EnvKey } from '../../config/env/env-keys.enum';
import { createLoggerOptions } from './logger.config';
import { LifecycleService } from './lifecycle.service';

@Global()
@Module({
  imports: [
    WinstonModule.forRootAsync({
      useFactory: () => {
        const nodeEnv = process.env[EnvKey.NODE_ENV] ?? 'development';
        const logLevel = process.env[EnvKey.LOG_LEVEL] ?? '';
        return createLoggerOptions(nodeEnv, logLevel);
      },
    }),
  ],
  providers: [LifecycleService],
  exports: [WinstonModule],
})
export class LoggerModule {}
