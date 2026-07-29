import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AppInfoDataDto,
  SupportResourceListDataDto,
} from '../dto/response.dto';

import type { SupportResourcesQueryDto } from '../dto/query.dto';
import {
  REFERENCE_DATA_UPDATED_AT,
  STATIC_SUPPORT_RESOURCES,
} from '../constants/support-resources-reference';
import { EnvKey } from '../../../config/env/env-keys.enum';

@Injectable()
export class SupportResourcesService {
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

  getResources(query: SupportResourcesQueryDto): SupportResourceListDataDto {
    const items = query.scope
      ? STATIC_SUPPORT_RESOURCES.filter((r) => r.scope === query.scope)
      : [...STATIC_SUPPORT_RESOURCES];

    return {
      items,
      updatedAt: REFERENCE_DATA_UPDATED_AT,
    };
  }

  getAppInfo(): AppInfoDataDto {
    return this.appInfo;
  }
}
