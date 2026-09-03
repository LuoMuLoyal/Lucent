import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppInfoService } from './info.service.js';

describe('AppInfoService', () => {
  let service: AppInfoService;

  beforeEach(async () => {
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
});
