import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { HealthIndicatorService } from '@nestjs/terminus';
import type { Cache } from 'cache-manager';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import { CacheHealthIndicator } from './cache.indicator.js';

/**
 * 用假 `HealthIndicatorService` 捕获 `up` / `down` 的调用与入参。
 * terminus 的真实实现依赖 `HealthCheckService` 的内部状态，单测里没必要拉进来。
 */
function createIndicatorDouble() {
  const up = vi.fn((details: Record<string, unknown>) => ({
    cache: { status: 'up', ...details },
  }));
  const down = vi.fn((details: Record<string, unknown>) => ({
    cache: { status: 'down', ...details },
  }));
  return {
    check: vi.fn(() => ({ up, down })),
    up,
    down,
  };
}

function createHarness(options: {
  redisUrl: string | null;
  cache: Pick<Cache, 'set' | 'get' | 'del'>;
}) {
  const indicatorDouble = createIndicatorDouble();
  const configService = {
    get: vi.fn((key: string) => {
      if (key === (EnvKey.REDIS_URL as string)) {
        return options.redisUrl ?? undefined;
      }
      return undefined;
    }),
  } as unknown as ConfigService;

  const indicator = new CacheHealthIndicator(
    indicatorDouble as unknown as HealthIndicatorService,
    configService,
    options.cache as unknown as Cache,
  );

  return { indicator, indicatorDouble };
}

describe('CacheHealthIndicator', () => {
  beforeEach(() => {
    // 探针失败路径会打 error 日志，测试里静音，避免污染输出
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports up with backend=memory when REDIS_URL is not configured', async () => {
    const { indicator, indicatorDouble } = createHarness({
      redisUrl: null,
      cache: { set: vi.fn(), get: vi.fn(), del: vi.fn() },
    });

    const result = await indicator.ping({ verbose: false });

    expect(result).toMatchObject({
      cache: { status: 'up', backend: 'memory' },
    });
    expect(indicatorDouble.down).not.toHaveBeenCalled();
  });

  it('reports up after a successful set/get/del round-trip', async () => {
    const { indicator, indicatorDouble } = createHarness({
      redisUrl: 'redis://127.0.0.1:6379',
      cache: {
        set: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue('ok'),
        del: vi.fn().mockResolvedValue(undefined),
      },
    });

    const result = await indicator.ping({ verbose: true });

    expect(result).toMatchObject({ cache: { status: 'up', backend: 'redis' } });
    expect(indicatorDouble.down).not.toHaveBeenCalled();
  });

  it('reports down when the round-trip returns an unexpected value', async () => {
    const { indicator } = createHarness({
      redisUrl: 'redis://127.0.0.1:6379',
      cache: {
        set: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue('not-ok'),
        del: vi.fn().mockResolvedValue(undefined),
      },
    });

    const result = await indicator.ping({ verbose: false });

    expect(result).toMatchObject({ cache: { status: 'down' } });
  });

  it('reports down when the client rejects (Redis unreachable)', async () => {
    const { indicator } = createHarness({
      redisUrl: 'redis://127.0.0.1:6379',
      cache: {
        set: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        get: vi.fn(),
        del: vi.fn(),
      },
    });

    const result = await indicator.ping({ verbose: false });

    expect(result).toMatchObject({ cache: { status: 'down' } });
  });

  /**
   * 压测 D2 的直接回归：客户端「永不返回」时，探针必须在硬超时内放弃，
   * 而不是一直等到 socket 层超时把整个 `/health` 拖挂。
   */
  it('times out instead of hanging when the client never settles', async () => {
    const { indicator } = createHarness({
      redisUrl: 'redis://127.0.0.1:6379',
      cache: {
        // 永不 resolve，模拟 Redis 连接卡死
        set: vi.fn(() => new Promise<never>(() => undefined)),
        get: vi.fn(),
        del: vi.fn(),
      },
    });

    const startedAt = Date.now();
    const result = await indicator.ping({ verbose: false });
    const elapsed = Date.now() - startedAt;

    expect(result).toMatchObject({ cache: { status: 'down' } });
    // 硬超时 1500ms，留出宽裕余量但仍远小于原先的 12s 挂起
    expect(elapsed).toBeLessThan(3_000);
  }, 10_000);
});
