import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

const mockRedisInstance = {
  eval: vi.fn(),
  quit: vi.fn().mockResolvedValue(undefined),
};

vi.mock('ioredis', () => {
  class MockRedis {
    eval = mockRedisInstance.eval;
    quit = mockRedisInstance.quit;
  }
  return { default: MockRedis };
});

describe('RedisService', () => {
  describe('when REDIS_URL is not configured', () => {
    it('isAvailable is false after onModuleInit', async () => {
      const configService = {
        get: vi.fn(() => undefined),
      } as unknown as ConfigService;
      const svc = new RedisService(configService);

      await svc.onModuleInit();

      expect(svc.isAvailable).toBe(false);
    });

    it('atomicIncrement throws when Redis is not available', async () => {
      const configService = {
        get: vi.fn(() => undefined),
      } as unknown as ConfigService;
      const svc = new RedisService(configService);

      await svc.onModuleInit();

      await expect(svc.atomicIncrement('key', 60_000)).rejects.toThrow(
        'Redis is not available',
      );
    });

    it('onModuleDestroy does not throw', async () => {
      const configService = {
        get: vi.fn(() => undefined),
      } as unknown as ConfigService;
      const svc = new RedisService(configService);

      await svc.onModuleInit();
      await expect(svc.onModuleDestroy()).resolves.toBeUndefined();
    });
  });

  describe('when REDIS_URL is configured', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockRedisInstance.eval.mockReset();
      mockRedisInstance.quit.mockResolvedValue(undefined);
    });

    it('logs a warning when quit fails during onModuleDestroy', async () => {
      const quitError = new Error('Connection already closed');
      mockRedisInstance.quit.mockRejectedValueOnce(quitError);

      const configService = {
        get: vi.fn((key: string) =>
          key === 'REDIS_URL' ? 'redis://127.0.0.1:6379' : undefined,
        ),
      } as unknown as ConfigService;
      const svc = new RedisService(configService);

      await svc.onModuleInit();
      const logger = (svc as unknown as { logger: { warn: vi.Mock } }).logger;
      const warnSpy = vi.spyOn(logger, 'warn');

      await expect(svc.onModuleDestroy()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Redis quit failed during shutdown'),
      );
    });

    it('isAvailable is true after onModuleInit', async () => {
      const configService = {
        get: vi.fn((key: string) =>
          key === 'REDIS_URL' ? 'redis://127.0.0.1:6379' : undefined,
        ),
      } as unknown as ConfigService;
      const svc = new RedisService(configService);

      await svc.onModuleInit();

      expect(svc.isAvailable).toBe(true);
      await svc.onModuleDestroy();
    });

    it('atomicIncrement calls eval with the Lua script', async () => {
      mockRedisInstance.eval.mockResolvedValueOnce(3);

      const configService = {
        get: vi.fn((key: string) =>
          key === 'REDIS_URL' ? 'redis://127.0.0.1:6379' : undefined,
        ),
      } as unknown as ConfigService;
      const svc = new RedisService(configService);

      await svc.onModuleInit();

      const result = await svc.atomicIncrement('rate-limit:key', 60_000);

      expect(result).toBe(3);
      expect(mockRedisInstance.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call'),
        1,
        'rate-limit:key',
        '60000',
      );
      await svc.onModuleDestroy();
    });
  });
});
