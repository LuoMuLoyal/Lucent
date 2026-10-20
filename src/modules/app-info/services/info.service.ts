import { Injectable, Optional, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppInfoDataDto } from '../dto/response.dto.js';
import { EnvKey } from '../../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../../config/runtime/runtime-config.types.js';

/**
 * Reads the client-facing "about" values.
 *
 * Resolved per request so publishing `MIN_CLIENT_VERSION` or `DOWNLOAD_URL`
 * shows up on the next call without a restart. The values are not secrets and
 * not startup wiring; empty means "not configured", which the client contract
 * already treats as such.
 */
@Injectable()
export class AppInfoService {
  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject(RuntimeConfigService)
    private readonly runtimeConfig?: RuntimeConfigPort,
  ) {}

  getAppInfo(): AppInfoDataDto {
    const values = this.runtimeConfig?.getSnapshot().values;
    return {
      supportEmail: this.read(EnvKey.SUPPORT_EMAIL, values),
      minClientVersion: this.read(EnvKey.MIN_CLIENT_VERSION, values),
      latestVersion: this.read(EnvKey.LATEST_VERSION, values),
      downloadUrl: this.read(EnvKey.DOWNLOAD_URL, values),
    };
  }

  private read(
    key:
      | EnvKey.SUPPORT_EMAIL
      | EnvKey.MIN_CLIENT_VERSION
      | EnvKey.LATEST_VERSION
      | EnvKey.DOWNLOAD_URL,
    values: Readonly<Record<string, unknown>> | undefined,
  ): string | null {
    const published = values?.[key];
    if (typeof published === 'string' && published.trim().length > 0) {
      return published.trim();
    }
    return this.configService.get<string>(key)?.trim() || null;
  }
}
