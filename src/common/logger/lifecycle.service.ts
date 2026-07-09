import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../config/config-keys.enum';
import { EnvKey } from '../../config/env-keys.enum';

/**
 * Emits structured lifecycle log entries when the application starts and stops.
 * Requires `app.enableShutdownHooks()` in bootstrap so that
 * `onApplicationShutdown` fires on SIGTERM/SIGINT.
 */
@Injectable()
export class LifecycleService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService,
  ) {
    this.logger.setContext(LifecycleService.name);
  }

  onApplicationBootstrap(): void {
    const env =
      this.configService.get<string>(EnvKey.NODE_ENV) ?? 'development';
    const host = this.configService.get<string>(`${ConfigKey.App}.host`);
    const port = this.configService.get<number>(`${ConfigKey.App}.port`);

    this.logger.info(
      {
        env,
        pid: process.pid,
        host,
        port,
      },
      'Application started',
    );
  }

  onApplicationShutdown(signal?: string): void {
    this.logger.info(
      {
        signal,
        pid: process.pid,
        uptimeSeconds: Number(process.uptime().toFixed(3)),
      },
      'Application shutting down',
    );
  }
}
