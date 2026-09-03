import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../config/env/config-keys.enum.js';
import { EnvKey } from '../../config/env/env-keys.enum.js';

/**
 * Emits structured lifecycle log entries when the application starts and stops.
 * Requires `app.enableShutdownHooks()` in bootstrap so that
 * `onApplicationShutdown` fires on SIGTERM/SIGINT.
 */
@Injectable()
export class LifecycleService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(LifecycleService.name);

  constructor(private readonly configService: ConfigService) {}

  onApplicationBootstrap(): void {
    const env =
      this.configService.get<string>(EnvKey.NODE_ENV) ?? 'development';
    const host = this.configService.get<string>(`${ConfigKey.App}.host`);
    const port = this.configService.get<number>(`${ConfigKey.App}.port`);

    this.logger.log(
      `Application started (env=${env}, pid=${String(process.pid)}, host=${host ?? '?'}, port=${String(port ?? '?')})`,
    );
  }

  onApplicationShutdown(signal?: string): void {
    this.logger.log(
      `Application shutting down (signal=${signal ?? '?'}, pid=${String(process.pid)}, uptime=${String(Number(process.uptime().toFixed(3)))}s)`,
    );
  }
}
