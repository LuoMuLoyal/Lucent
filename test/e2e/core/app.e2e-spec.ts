import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Controller, Get } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppController } from '../../../src/app.controller';
import { AppService } from '../../../src/app.service';
import { ApiExceptionFilter } from '../../../src/common/filters/api-exception.filter';
import { RequestContextService } from '../../../src/common/logger/request-context.service';
import { MetricsService } from '../../../src/common/metrics/metrics.service';
import { SlowRequestInterceptor } from '../../../src/common/interceptors/slow-request.interceptor';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { setupApp } from '../../../src/setup-app';

describe('Lucent API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: { $queryRaw: jest.Mock; $queryRawUnsafe: jest.Mock };
  let cache: {
    set: jest.Mock;
    get: jest.Mock;
    del: jest.Mock;
  };

  beforeEach(async () => {
    const rawOk = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    prisma = {
      $queryRaw: rawOk,
      $queryRawUnsafe: rawOk,
    };
    cache = {
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController, TestEchoController],
      providers: [
        AppService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: CACHE_MANAGER,
          useValue: cache,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'NODE_ENV') {
                return 'test';
              }
              if (key === 'REDIS_URL') {
                return undefined;
              }
              if (key === 'app.corsOrigin') {
                return true;
              }
              return undefined;
            }),
          },
        },
        RequestContextService,
        ApiExceptionFilter,
        MetricsService,
        SlowRequestInterceptor,
        {
          provide: PinoLogger,
          useValue: {
            setContext: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    setupApp(app, app.get(ConfigService));
    await app.init();
  });

  it('/api/v1/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect('X-Request-Id', /.+/)
      .expect((response) => {
        expect(response.body).toMatchObject({
          code: 0,
          message: '',
          data: {
            probe: 'ready',
            status: 'ok',
            summary: {
              total: 2,
              passed: 2,
              failed: 0,
            },
          },
        });
      });
  });

  it('/api/v1/health/ready (GET) returns 503 when a critical dependency is down', () => {
    prisma.$queryRawUnsafe.mockRejectedValue(new Error('db down'));

    return request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(503)
      .expect('X-Request-Id', /.+/)
      .expect((response) => {
        expect(response.body).toMatchObject({
          code: 0,
          message: '',
          data: {
            probe: 'ready',
            status: 'error',
            summary: {
              total: 2,
              passed: 1,
              failed: 1,
            },
          },
        });
      });
  });

  // ── Liveness Probe ──────────────────────────────────────────

  it('/api/v1/health/live (GET) returns 200 with liveness probe', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200)
      .expect('X-Request-Id', /.+/)
      .expect((response) => {
        expect(response.body).toMatchObject({
          code: 0,
          message: '',
          data: {
            probe: 'live',
            status: 'ok',
            summary: {
              total: 0,
              passed: 0,
              failed: 0,
            },
          },
        });
        // Liveness probe has no components — it only checks process health
        const data = response.body.data;
        expect(data.components).toEqual([]);
        expect(data.app).toBeDefined();
        expect(data.app.name).toBe('lucent');
        expect(data.app.pid).toBe(process.pid);
      });
  });

  it('/api/v1/health/live (GET) always returns 200 even when DB is down', () => {
    prisma.$queryRawUnsafe.mockRejectedValue(new Error('db down'));

    return request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200)
      .expect((response) => {
        expect(response.body.data.status).toBe('ok');
        expect(response.body.data.summary).toEqual({
          total: 0,
          passed: 0,
          failed: 0,
        });
      });
  });

  // ── Deep Health Probe ────────────────────────────────────────

  it('/api/v1/health/deep (GET) returns 200 with detailed component diagnostics', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health/deep')
      .expect(200)
      .expect('X-Request-Id', /.+/)
      .expect((response) => {
        expect(response.body).toMatchObject({
          code: 0,
          message: '',
          data: {
            probe: 'deep',
            status: 'ok',
            summary: {
              total: 2,
              passed: 2,
              failed: 0,
            },
          },
        });

        const components = response.body.data.components as Array<{
          name: string;
          status: string;
          critical: boolean;
          details: Record<string, unknown> | null;
          error: string | null;
        }>;
        expect(components).toHaveLength(2);

        // Database component should include detailed diagnostics
        const dbComponent = components.find((c) => c.name === 'database');
        expect(dbComponent).toBeDefined();
        expect(dbComponent!.status).toBe('up');
        expect(dbComponent!.critical).toBe(true);
        expect(dbComponent!.details).toMatchObject({
          driver: 'prisma',
          probe: 'SELECT 1',
        });

        // Cache component should include backend info
        const cacheComponent = components.find((c) => c.name === 'cache');
        expect(cacheComponent).toBeDefined();
        expect(cacheComponent!.status).toBe('up');
        expect(cacheComponent!.details).toMatchObject({
          backend: 'memory',
          mode: 'fallback',
        });
      });
  });

  it('/api/v1/health/deep (GET) returns 503 when a critical dependency is down', () => {
    prisma.$queryRawUnsafe.mockRejectedValue(new Error('db down'));

    return request(app.getHttpServer())
      .get('/api/v1/health/deep')
      .expect(503)
      .expect((response) => {
        expect(response.body.data.status).toBe('error');
        expect(response.body.data.summary).toEqual({
          total: 2,
          passed: 1,
          failed: 1,
        });

        const components = response.body.data.components as Array<{
          name: string;
          status: string;
          critical: boolean;
          details: Record<string, unknown> | null;
          error: string | null;
        }>;
        const dbComponent = components.find((c) => c.name === 'database');
        expect(dbComponent!.status).toBe('down');
        expect(dbComponent!.error).toBeTruthy();
        expect(dbComponent!.details).toMatchObject({
          driver: 'prisma',
          probe: 'SELECT 1',
        });
      });
  });

  it('/api/v1/test-echo (GET) still uses the API envelope by default', () => {
    return request(app.getHttpServer())
      .get('/api/v1/test-echo')
      .expect(200)
      .expect({
        code: 0,
        message: '',
        data: {
          ok: true,
        },
      });
  });

  afterEach(async () => {
    await app.close();
  });
});

@Controller({
  path: 'test-echo',
  version: '1',
})
class TestEchoController {
  @Get()
  getEcho() {
    return { ok: true };
  }
}
