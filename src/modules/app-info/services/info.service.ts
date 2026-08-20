import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppInfoDataDto } from '../dto/response.dto';
import { EnvKey } from '../../../config/env/env-keys.enum';

@Injectable()
export class AppInfoService {
  private readonly appInfo: AppInfoDataDto;

  constructor(private readonly configService: ConfigService) {
    this.appInfo = {
      supportEmail:
        this.configService.get<string>(EnvKey.SUPPORT_EMAIL)?.trim() || null,
      minClientVersion:
        this.configService.get<string>(EnvKey.MIN_CLIENT_VERSION)?.trim() ||
        null,
      latestVersion:
        this.configService.get<string>(EnvKey.LATEST_VERSION)?.trim() || null,
      downloadUrl:
        this.configService.get<string>(EnvKey.DOWNLOAD_URL)?.trim() || null,
    };
  }

  getAppInfo(): AppInfoDataDto {
    return this.appInfo;
  }
}
