import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Controller, Get } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppController } from '../../../src/app.controller';
import { AppService } from '../../../src/app.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { setupApp } from '../../../src/setup-app';

describe('Lucent API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: { $queryRawUnsafe: jest.Mock };
  let cache: {
    set: jest.Mock;
    get: jest.Mock;
    del: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
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
