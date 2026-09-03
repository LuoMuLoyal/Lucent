import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppInfoController } from './app-info.controller.js';
import { AppInfoService } from './services/info.service.js';

describe('AppInfoController', () => {
  let controller: AppInfoController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppInfoController],
      providers: [
        AppInfoService,
        {
          provide: ConfigService,
          useValue: {
            get: () => undefined,
          },
        },
      ],
    }).compile();

    controller = module.get(AppInfoController);
  });

  it('returns app info with support email and min client version', () => {
    const result = controller.getAppInfo();

    expect(result).toBeDefined();
    expect(result.supportEmail).toBeNull();
    expect(result.minClientVersion).toBeNull();
  });
});
