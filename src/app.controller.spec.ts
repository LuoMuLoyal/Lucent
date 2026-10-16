import { Test, type TestingModule } from '@nestjs/testing';
import type { HealthCheckResult } from '@nestjs/terminus';
import type { FastifyReply } from 'fastify';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

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

  it('returns 503 for an unhealthy readiness alias', async () => {
    const result = makeResult('error');
    const response = makeReply();
    service.getHealth.mockResolvedValue(result);
    service.isHealthy.mockReturnValue(false);

    await expect(controller.getHealth(response)).resolves.toBe(result);
    expect(response.status).toHaveBeenCalledWith(503);
  });

  it('returns 200 for a healthy readiness alias', async () => {
    const result = makeResult('ok');
    const response = makeReply();
    service.getHealth.mockResolvedValue(result);
    service.isHealthy.mockReturnValue(true);

    await expect(controller.getHealth(response)).resolves.toBe(result);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('returns the liveness result without touching the reply status', async () => {
    const result = makeResult('ok');
    service.getLiveHealth.mockResolvedValue(result);

    await expect(controller.getLiveHealth()).resolves.toBe(result);
  });

  it('returns 200 for a healthy ready probe', async () => {
    const result = makeResult('ok');
    const response = makeReply();
    service.getReadyHealth.mockResolvedValue(result);
    service.isHealthy.mockReturnValue(true);

    await expect(controller.getReadyHealth(response)).resolves.toBe(result);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('returns 503 for an unhealthy ready probe', async () => {
    const result = makeResult('error');
    const response = makeReply();
    service.getReadyHealth.mockResolvedValue(result);
    service.isHealthy.mockReturnValue(false);

    await expect(controller.getReadyHealth(response)).resolves.toBe(result);
    expect(response.status).toHaveBeenCalledWith(503);
  });

  it('returns 200 for a healthy deep health probe', async () => {
    const result = makeResult('ok');
    const response = makeReply();
    service.getDeepHealth.mockResolvedValue(result);
    service.isHealthy.mockReturnValue(true);

    await expect(controller.getDeepHealth(response)).resolves.toBe(result);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('returns 503 for an unhealthy deep health probe', async () => {
    const result = makeResult('error');
    const response = makeReply();
    service.getDeepHealth.mockResolvedValue(result);
    service.isHealthy.mockReturnValue(false);

    await expect(controller.getDeepHealth(response)).resolves.toBe(result);
    expect(response.status).toHaveBeenCalledWith(503);
  });
});

function makeReply(): FastifyReply {
  return {
    status: vi.fn().mockReturnThis(),
  } as unknown as FastifyReply;
}

function makeResult(status: HealthCheckResult['status']): HealthCheckResult {
  return {
    status,
    info:
      status === 'ok'
        ? { database: { status: 'up' }, cache: { status: 'up' } }
        : { database: { status: 'up' } },
    error:
      status === 'ok' ? {} : { cache: { status: 'down', message: 'down' } },
    details: {
      database: { status: 'up', driver: 'prisma' },
      cache: { status: status === 'ok' ? 'up' : 'down' },
    },
  };
}
