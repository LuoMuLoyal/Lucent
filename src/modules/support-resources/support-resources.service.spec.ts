import { Test, type TestingModule } from '@nestjs/testing';
import { SupportResourcesService } from './support-resources.service';

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

  it('should filter resources by scope', () => {
    const result = service.getResources({ scope: 'campus' });
    expect(result.items.every((item) => item.scope === 'campus')).toBe(true);
  });

  it('should return app info with package metadata', () => {
    const info = service.getAppInfo();
    expect(info.name).toBe('lucent');
    expect(info.version).toBeTruthy();
    expect(info.buildDate).toBeTruthy();
  });
});
