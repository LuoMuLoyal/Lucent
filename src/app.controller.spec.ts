import { Test, type TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { AppController } from './app.controller';
import type { HealthProbeDto } from './app.dto';
import { AppService } from './app.service';

describe('AppController', () => {
  let controller: AppController;
  let service: vi.Mocked<AppService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: {
            getHealth: vi.fn(),
            getLiveHealth: vi.fn(),
            getReadyHealth: vi.fn(),
            getDeepHealth: vi.fn(),
            isHealthy: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(AppController);
    service = module.get(AppService);
  });

  it('returns 503 for unhealthy readiness alias', async () => {
    const probe = makeProbe({ status: 'error' });
    const response = {
      status: vi.fn().mockReturnThis(),
    } as unknown as Response;
    service.getHealth.mockResolvedValue(probe);
    service.isHealthy.mockReturnValue(false);

    await expect(controller.getHealth(response)).resolves.toBe(probe);
    expect(response.status).toHaveBeenCalledWith(503);
  });

  it('returns 200 for healthy deep health probe', async () => {
    const probe = makeProbe({ probe: 'deep' });
    const response = {
      status: vi.fn().mockReturnThis(),
    } as unknown as Response;
    service.getDeepHealth.mockResolvedValue(probe);
    service.isHealthy.mockReturnValue(true);

    await expect(controller.getDeepHealth(response)).resolves.toBe(probe);
    expect(response.status).toHaveBeenCalledWith(200);
  });
});

function makeProbe(overrides: Partial<HealthProbeDto> = {}): HealthProbeDto {
  return {
    probe: 'ready',
    status: 'ok',
    checkedAt: '2026-06-13T12:00:00.000Z',
    app: {
      name: 'lucent',
      env: 'test',
      pid: 1,
      uptimeSeconds: 1.2,
      memoryRssBytes: 1,
      memoryHeapUsedBytes: 1,
    },
    summary: {
      total: 1,
      passed: 1,
      failed: 0,
    },
    components: [
      {
        name: 'database',
        status: 'up',
        critical: true,
        durationMs: 1,
        error: null,
        details: { driver: 'prisma' },
      },
    ],
    ...overrides,
  };
}
