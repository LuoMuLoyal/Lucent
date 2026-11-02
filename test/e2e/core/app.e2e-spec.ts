import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Controller, Get, Res } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, RouteConfig } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TerminusModule } from '@nestjs/terminus';
import type { FastifyReply } from 'fastify';
import { I18nService } from 'nestjs-i18n';
import { gunzipSync } from 'node:zlib';
import request from 'supertest';
import { AppController } from '../../../src/app.controller.js';
import { AppService } from '../../../src/app.service.js';
import { ApiExceptionFilter } from '../../../src/common/filters/api-exception.filter.js';
import { ProblemCatalog } from '../../../src/common/api/problem-catalog.js';
import { MetricsService } from '../../../src/common/metrics/metrics.service.js';
import {
  AppInfoHealthIndicator,
  CacheHealthIndicator,
  DatabaseHealthIndicator,
  endSse,
  prepareSse,
  SlowRequestInterceptor,
  writeSseEvent,
} from '../../../src/common/index.js';
import { PrismaService } from '../../../src/prisma/index.js';
import { setupApp } from '../../../src/setup-app.js';

describe('Lucent API (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: { $queryRaw: vi.Mock; $queryRawUnsafe: vi.Mock };
  let cache: {
    set: vi.Mock;
    get: vi.Mock;
    del: vi.Mock;
  };

  beforeAll(async () => {
    const rawOk = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
    prisma = {
      $queryRaw: rawOk,
      $queryRawUnsafe: rawOk,
    };
    cache = {
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [AppController, TestEchoController],
      providers: [
        AppService,
        AppInfoHealthIndicator,
        CacheHealthIndicator,
        DatabaseHealthIndicator,
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
            get: vi.fn().mockImplementation((key: string) => {
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
            getOrThrow: vi.fn().mockImplementation((key: string) => {
              // MetricsService and SlowRequestInterceptor require the YAML
              // config; return a minimal stub with the needed fields.
              if (key === 'yaml') {
                return {
                  metrics: { enabled: false, path: '/metrics' },
                  log: { slowRequestThresholdMs: 5000 },
                };
              }
              throw new Error(`Config key not mocked: ${key}`);
            }),
          },
        },
        {
          provide: I18nService,
          useValue: {
            translate: vi.fn().mockReturnValue('Error'),
            t: vi.fn().mockReturnValue('Error'),
          },
        },
        {
          provide: ProblemCatalog,
          useValue: {
            resolve: vi.fn().mockReturnValue({
              type: 'about:blank',
              title: 'Error',
              status: 500,
            }),
          },
        },
        ApiExceptionFilter,
        MetricsService,
        SlowRequestInterceptor,
      ],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ trustProxy: true }),
      { bodyParser: false },
    );
    await setupApp(app, app.get(ConfigService));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 30_000);

  // Reset prisma mock to "ok" before each test
  beforeEach(() => {
    const rawOk = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    prisma.$queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }]);
    // Re-assign the mock function to ensure clean state
    prisma.$queryRaw = rawOk;
    prisma.$queryRawUnsafe = rawOk;
  });

  it('/api/v1/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('ok');
        expect(response.body.error).toEqual({});
        expect(response.body.info).toMatchObject({
          database: { status: 'up' },
          cache: { status: 'up' },
        });
        expect(response.body.info.app.name).toBe('lucent');
      });
  });

  it('omits the HTTPS-only security headers when no https public URL is configured', () => {
    // The mocked ConfigService exposes no publicBaseUrl, i.e. the plain-HTTP
    // deployment. `upgrade-insecure-requests` would rewrite /admin/assets/* to
    // https there, so every asset fails and the console renders blank.
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect((response) => {
        const csp = response.headers['content-security-policy'];
        expect(csp).toBeDefined();
        expect(csp).not.toContain('upgrade-insecure-requests');
        expect(response.headers['strict-transport-security']).toBeUndefined();
      });
  });

  it('/api/v1/health/ready (GET) returns 503 when a critical dependency is down', () => {
    prisma.$queryRaw.mockRejectedValue(new Error('db down'));

    return request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(503)
      .expect((response) => {
        expect(response.body.status).toBe('error');
        // Native terminus body, not RFC 9457 Problem Details.
        expect(response.body.type).toBeUndefined();
        expect(response.body.error.database.status).toBe('down');
        expect(response.body.info.cache.status).toBe('up');
      });
  });

  // ── Liveness Probe ──────────────────────────────────────────

  it('/api/v1/health/live (GET) returns 200 with liveness probe', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('ok');
        // Liveness probe has no dependency components — process info only.
        expect(response.body.details.database).toBeUndefined();
        expect(response.body.details.cache).toBeUndefined();
        expect(response.body.info.app.name).toBe('lucent');
        expect(response.body.info.app.pid).toBe(process.pid);
      });
  });

  it('/api/v1/health/live (GET) always returns 200 even when DB is down', () => {
    prisma.$queryRaw.mockRejectedValue(new Error('db down'));

    return request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('ok');
        expect(response.body.details.database).toBeUndefined();
      });
  });

  // ── Deep Health Probe ────────────────────────────────────────

  it('/api/v1/health/deep (GET) returns 200 with detailed component diagnostics', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health/deep')
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('ok');

        expect(response.body.details.database).toMatchObject({
          status: 'up',
          driver: 'prisma',
          probe: 'SELECT 1',
        });
        expect(response.body.details.cache).toMatchObject({
          status: 'up',
          backend: 'memory',
          mode: 'fallback',
        });
      });
  });

  it('/api/v1/health/deep (GET) returns 503 when a critical dependency is down', () => {
    prisma.$queryRaw.mockRejectedValue(new Error('db down'));

    return request(app.getHttpServer())
      .get('/api/v1/health/deep')
      .expect(503)
      .expect((response) => {
        expect(response.body.status).toBe('error');
        expect(response.body.type).toBeUndefined();
        expect(response.body.error.database).toMatchObject({
          status: 'down',
          message: 'db down',
          driver: 'prisma',
          probe: 'SELECT 1',
        });
      });
  });

  it('/api/v1/test-echo (GET) returns the direct resource', () => {
    return request(app.getHttpServer())
      .get('/api/v1/test-echo')
      .expect(200)
      .expect({ ok: true });
  });

  // ── Response compression ────────────────────────────────────────

  it('gzip-compresses a large JSON response when the client negotiates it', async () => {
    const fastify = app.getHttpAdapter().getInstance();
    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/test-echo/large',
      headers: { 'accept-encoding': 'gzip' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBe('gzip');
    // `inject` does not decode; verify the payload survives the round-trip.
    const decoded = JSON.parse(gunzipSync(response.rawPayload).toString());
    expect(decoded.blob).toHaveLength(4096);
  });

  it('does not compress a large JSON response without a negotiated encoding', async () => {
    const fastify = app.getHttpAdapter().getInstance();
    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/test-echo/large',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBeUndefined();
  });

  it('leaves the SSE stream uncompressed (route opts out of compression)', async () => {
    // superagent negotiates gzip by default; the stream must stay unbuffered.
    const response = await request(app.getHttpServer()).get(
      '/api/v1/test-echo/stream',
    );

    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toContain('event: chunk');
  });

  afterAll(async () => {
    await app.close();
  }, 30_000);
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

  @Get('large')
  getLarge() {
    return { ok: true, blob: 'x'.repeat(4096) };
  }

  @Get('stream')
  @RouteConfig({ compress: false })
  stream(@Res() reply: FastifyReply) {
    prepareSse(reply.raw, undefined, 'en', reply.getHeaders());
    writeSseEvent(reply.raw, { event: 'chunk', data: { content: 'hello' } });
    endSse(reply.raw);
  }
}
