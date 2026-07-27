import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ResultCode } from '../../common';
import { SupportResourcesController } from './support-resources.controller';
import { SupportResourcesService } from './services/resources.service';

describe('SupportResourcesController', () => {
  let controller: SupportResourcesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SupportResourcesController],
      providers: [
        SupportResourcesService,
        {
          provide: ConfigService,
          useValue: {
            get: () => undefined,
          },
        },
      ],
    }).compile();

    controller = module.get(SupportResourcesController);
  });

  it('should return all resources when no scope filter is given', () => {
    const result = controller.getResources({});

    expect(result.code).toBe(ResultCode.SUCCESS);
    expect(result.data).toBeDefined();
    expect(result.data?.items.length).toBeGreaterThan(0);
    expect(result.data?.updatedAt).toBeTruthy();
  });

  it('should filter resources by help scope', () => {
    const result = controller.getResources({ scope: 'help' });

    expect(result.code).toBe(ResultCode.SUCCESS);
    expect(result.data).toBeDefined();
    for (const item of result.data?.items ?? []) {
      expect(item.scope).toBe('help');
    }
  });

  it('should filter resources by about scope', () => {
    const result = controller.getResources({ scope: 'about' });

    expect(result.code).toBe(ResultCode.SUCCESS);
    expect(result.data).toBeDefined();
    for (const item of result.data?.items ?? []) {
      expect(item.scope).toBe('about');
    }
  });

  it('should return app info with support email and min client version', () => {
    const result = controller.getAppInfo();

    expect(result.code).toBe(ResultCode.SUCCESS);
    expect(result.data).toBeDefined();
    expect(result.data?.supportEmail).toBeNull();
    expect(result.data?.minClientVersion).toBeNull();
  });
});
