import { Test, type TestingModule } from '@nestjs/testing';
import { SupportResourcesService } from './services/support-resources.service';

describe('SupportResourcesService', () => {
  let service: SupportResourcesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SupportResourcesService],
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

  it('should return app info with package metadata', () => {
    const info = service.getAppInfo();
    expect(info.name).toBe('lucent');
    expect(info.version).toBeTruthy();
    expect(info.buildDate).toBeTruthy();
  });
});
