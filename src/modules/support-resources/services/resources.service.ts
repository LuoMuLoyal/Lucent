import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  AppInfoDataDto,
  SupportResourceListDataDto,
  SupportResourcesQueryDto,
} from '../dto';
import { nowIsoString } from '../../../common/helpers';
import {
  REFERENCE_DATA_UPDATED_AT,
  STATIC_SUPPORT_RESOURCES,
} from '../constants';

const BUILD_DATE = nowIsoString();

interface PackageJson {
  name: string;
  version: string;
  description?: string;
}

function readPackageJson(): PackageJson {
  const pkgPath = resolve(__dirname, '../../../../package.json');
  const raw = readFileSync(pkgPath, 'utf-8');
  return JSON.parse(raw) as PackageJson;
}

@Injectable()
export class SupportResourcesService {
  private readonly appInfo: AppInfoDataDto;

  constructor() {
    const pkg = readPackageJson();
    this.appInfo = {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description ?? '',
      buildDate: BUILD_DATE,
      minClientVersion: null,
      supportEmail: null,
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
