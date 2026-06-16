import { Injectable } from '@nestjs/common';
import type {
  AppInfoDataDto,
  SupportResourceListDataDto,
  SupportResourcesQueryDto,
} from './dto';
import {
  REFERENCE_DATA_UPDATED_AT,
  STATIC_SUPPORT_RESOURCES,
} from './support-resources-reference';

const BUILD_DATE = new Date().toISOString();

@Injectable()
export class SupportResourcesService {
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../../../package.json') as {
      name: string;
      version: string;
      description?: string;
    };

    return {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description ?? '',
      buildDate: BUILD_DATE,
      minClientVersion: null,
      supportEmail: null,
      privacyPolicyUrl: null,
      termsOfServiceUrl: null,
    };
  }
}
