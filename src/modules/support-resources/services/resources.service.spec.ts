import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SupportResourcesService } from './resources.service';

describe('SupportResourcesService', () => {
  let service: SupportResourcesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupportResourcesService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'SUPPORT_EMAIL') return 'luomuloyal@qq.com';
              if (key === 'MIN_CLIENT_VERSION') return '0.1.0';
              if (key === 'LATEST_VERSION') return '0.2.0';
              if (key === 'DOWNLOAD_URL')
                return 'https://github.com/LuoMuLoyal/Luminous';
              return undefined;
            },
          },
        },
      ],
    }).compile();

    service = module.get(SupportResourcesService);
  });

  it('should return all resources when no scope filter is given', () => {
    const result = service.getResources({});
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('should filter resources by help scope', () => {
    const result = service.getResources({ scope: 'help' });
    expect(result.items.every((item) => item.scope === 'help')).toBe(true);
  });

  it('should filter resources by about scope', () => {
    const result = service.getResources({ scope: 'about' });
    expect(result.items.every((item) => item.scope === 'about')).toBe(true);
  });

  it('should return app info with all fields', () => {
    const info = service.getAppInfo();
    expect(info.supportEmail).toBe('luomuloyal@qq.com');
    expect(info.minClientVersion).toBe('0.1.0');
    expect(info.latestVersion).toBe('0.2.0');
    expect(info.downloadUrl).toBe('https://github.com/LuoMuLoyal/Luminous');
  });
});
