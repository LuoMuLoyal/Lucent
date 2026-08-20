import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ResultCode } from '../../common';
import { AppInfoController } from './app-info.controller';
import { AppInfoService } from './services/info.service';

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

    expect(result.code).toBe(ResultCode.SUCCESS);
    expect(result.data).toBeDefined();
    expect(result.data?.supportEmail).toBeNull();
    expect(result.data?.minClientVersion).toBeNull();
  });
});
