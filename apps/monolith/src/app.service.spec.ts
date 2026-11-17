import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import { EnvKey } from './config/env/env-keys.enum.js';
import { PrismaService } from './prisma/index.js';
import { AppService } from './app.service.js';
import {
  AppInfoHealthIndicator,
  CacheHealthIndicator,
  DatabaseHealthIndicator,
} from './common/index.js';

describe('AppService', () => {
  let prisma: { $queryRaw: vi.Mock };
  let cache: {
    set: vi.Mock;
    get: vi.Mock;
    del: vi.Mock;
  };

  function buildModule(redisUrl?: string): Promise<TestingModule> {
    return Test.createTestingModule({
      imports: [TerminusModule],
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
            get: vi.fn().mockImplementation((key: unknown) => {
              if (key === EnvKey.NODE_ENV) {
                return 'test';
              }
              if (key === EnvKey.REDIS_URL) {
                return redisUrl;
              }
              return undefined;
            }),
          },
        },
      ],
    }).compile();
  }

  beforeEach(() => {
    prisma = {
      $queryRaw: vi.fn(),
    };
    cache = {
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
    };
  });

  it('returns an ok liveness probe without dependency checks', async () => {
    const service = (await buildModule()).get(AppService);

    const result = await service.getLiveHealth();

    expect(result.status).toBe('ok');
    expect(result.details['app']).toMatchObject({
      status: 'up',
      name: 'lucent',
      env: 'test',
    });
    expect(result.details['database']).toBeUndefined();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns an ok readiness probe when database and memory cache are available', async () => {
    prisma.$queryRaw.mockResolvedValue([{}]);
    const service = (await buildModule()).get(AppService);

    const result = await service.getReadyHealth();

    expect(result.status).toBe('ok');
    expect(result.error).toEqual({});
    expect(result.details['database']).toMatchObject({
      status: 'up',
      driver: 'prisma',
    });
    expect(result.details['cache']).toMatchObject({
      status: 'up',
      backend: 'memory',
    });
  });

  it('reports deeper diagnostics for the deep probe', async () => {
    prisma.$queryRaw.mockResolvedValue([{}]);
    const service = (await buildModule()).get(AppService);

    const result = await service.getDeepHealth();

    expect(result.status).toBe('ok');
    expect(result.details['database']).toMatchObject({
      status: 'up',
      probe: 'SELECT 1',
    });
    expect(result.details['cache']).toMatchObject({
      status: 'up',
      backend: 'memory',
      mode: 'fallback',
    });
  });

  it('returns an error readiness probe when configured redis round-trip fails', async () => {
    prisma.$queryRaw.mockResolvedValue([{}]);
    cache.set.mockRejectedValue(new Error('redis unavailable'));
    const service = (await buildModule('redis://127.0.0.1:6379/0')).get(
      AppService,
    );

    const result = await service.getReadyHealth();

    expect(result.status).toBe('error');
    expect(result.info?.['database']).toMatchObject({ status: 'up' });
    expect(result.error?.['cache']).toMatchObject({
      status: 'down',
      message: 'redis unavailable',
      backend: 'redis',
    });
  });
});
