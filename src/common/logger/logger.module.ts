import { Global, Module } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { EnvKey } from '../../config/env-keys.enum';
import { createWinstonLoggerOptions } from './logger.config';

@Global()
@Module({
  imports: [
    WinstonModule.forRootAsync({
      useFactory: () => {
        const nodeEnv = process.env[EnvKey.NODE_ENV] ?? 'development';
        const logLevel = process.env[EnvKey.LOG_LEVEL] ?? '';
        return createWinstonLoggerOptions(nodeEnv, logLevel);
      },
    }),
  ],
  exports: [WinstonModule],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class LoggerModule {}
