import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { EnvKey } from './config/env-keys.enum';
import { PrismaService } from './prisma';
import { AppService } from './app.service';

describe('AppService', () => {
  let service: AppService;
  let prisma: { $queryRaw: vi.Mock };
  let cache: {
    set: vi.Mock;
    get: vi.Mock;
    del: vi.Mock;
  };

  beforeEach(async () => {
    prisma = {
      $queryRaw: vi.fn(),
    };
    cache = {
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
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
            get: vi.fn().mockImplementation((key: unknown) => {
              if (key === EnvKey.NODE_ENV || key === 'NODE_ENV') {
                return 'test';
              }
              if (key === EnvKey.REDIS_URL || key === 'REDIS_URL') {
                return undefined;
              }
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(AppService);
  });

  it('returns an ok liveness probe without dependency checks', () => {
    const result = service.getLiveHealth();

    expect(result).toMatchObject({
      probe: 'live',
      status: 'ok',
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
      },
      components: [],
    });
    expect(result.app.name).toBe('lucent');
    expect(result.app.env).toBe('test');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns an ok readiness probe when database and memory cache are available', async () => {
    prisma.$queryRaw.mockResolvedValue([{}]);

    const result = await service.getReadyHealth();

    expect(result).toMatchObject({
      probe: 'ready',
      status: 'ok',
      summary: {
        total: 2,
        passed: 2,
        failed: 0,
      },
    });
    expect(result.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'database',
          status: 'up',
          critical: true,
          error: null,
          details: { driver: 'prisma' },
        }),
        expect.objectContaining({
          name: 'cache',
          status: 'up',
          critical: false,
          error: null,
          details: { backend: 'memory' },
        }),
      ]),
    );
  });

  it('returns an error readiness probe when configured redis round-trip fails', async () => {
    prisma.$queryRaw.mockResolvedValue([{}]);
    cache.set.mockRejectedValue(new Error('redis unavailable'));

    const module: TestingModule = await Test.createTestingModule({
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
            get: vi.fn().mockImplementation((key: unknown) => {
              if (key === EnvKey.NODE_ENV || key === 'NODE_ENV') {
                return 'test';
              }
              if (key === EnvKey.REDIS_URL || key === 'REDIS_URL') {
                return 'redis://127.0.0.1:6379/0';
              }
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(AppService);

    const result = await service.getReadyHealth();

    expect(result.status).toBe('error');
    expect(result.summary).toEqual({
      total: 2,
      passed: 1,
      failed: 1,
    });
    expect(result.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'cache',
          status: 'down',
          critical: true,
          error: 'redis unavailable',
          details: { backend: 'redis' },
        }),
      ]),
    );
  });
});
