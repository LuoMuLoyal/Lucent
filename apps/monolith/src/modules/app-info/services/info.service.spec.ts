import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EnvKey } from '../../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../../config/runtime/runtime-config.service.js';
import { AppInfoService } from './info.service.js';

describe('AppInfoService', () => {
  let service: AppInfoService;
  let runtimeValues: Record<string, unknown>;

  beforeEach(async () => {
    runtimeValues = {};
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppInfoService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'SUPPORT_EMAIL') return 'luomuloyal@qq.com';
              if (key === 'MIN_CLIENT_VERSION') return '0.1.0';
              if (key === 'LATEST_VERSION') return '0.2.0';
              if (key === 'DOWNLOAD_URL') {
                return 'https://github.com/LuoMuLoyal/Luminous';
              }
              return undefined;
            },
          },
        },
        {
          provide: RuntimeConfigService,
          useValue: { getSnapshot: () => ({ values: runtimeValues }) },
        },
      ],
    }).compile();

    service = module.get(AppInfoService);
  });

  it('returns app info with all configured fields', () => {
    expect(service.getAppInfo()).toEqual({
      supportEmail: 'luomuloyal@qq.com',
      minClientVersion: '0.1.0',
      latestVersion: '0.2.0',
      downloadUrl: 'https://github.com/LuoMuLoyal/Luminous',
    });
  });

  it('reflects a published value on the next request', () => {
    runtimeValues[EnvKey.MIN_CLIENT_VERSION] = '1.4.0';
    runtimeValues[EnvKey.DOWNLOAD_URL] = 'https://example.com/app';

    expect(service.getAppInfo()).toEqual({
      supportEmail: 'luomuloyal@qq.com',
      minClientVersion: '1.4.0',
      latestVersion: '0.2.0',
      downloadUrl: 'https://example.com/app',
    });
  });

  it('falls back to the environment when a published string is empty', () => {
    runtimeValues[EnvKey.LATEST_VERSION] = '   ';

    expect(service.getAppInfo().latestVersion).toBe('0.2.0');
  });
});
