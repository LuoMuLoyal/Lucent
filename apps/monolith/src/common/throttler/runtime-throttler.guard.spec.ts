import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import type {
  RuntimeConfigPort,
  RuntimeConfigSnapshot,
} from '../../config/runtime/runtime-config.types.js';
import { RuntimeThrottlerGuard } from './runtime-throttler.guard.js';

describe('RuntimeThrottlerGuard', () => {
  const options: ThrottlerModuleOptions = {
    throttlers: [{ ttl: 60_000, limit: 100 }],
  };

  function createSnapshot(
    ttl: number | undefined,
    limit: number | undefined,
  ): RuntimeConfigSnapshot {
    return {
      values: {
        [EnvKey.THROTTLE_TTL_MS]: ttl,
        [EnvKey.THROTTLE_LIMIT]: limit,
      },
      version: 'test#1',
      source: 'remote',
      revision: 'test',
      seq: 1,
    } as unknown as RuntimeConfigSnapshot;
  }

  function createContext(): ExecutionContext {
    return {
      getHandler: () => ({ name: 'list' }),
      getClass: () => ({ name: 'MedicinesController' }),
      switchToHttp: () => ({
        getRequest: () => ({ ip: '127.0.0.1', headers: {} }),
        getResponse: () => ({ setHeader: vi.fn() }),
      }),
    } as unknown as ExecutionContext;
  }

  function createHarness(options?: {
    published?: { ttl: number; limit: number };
    blocked?: boolean;
  }) {
    const published = options?.published ?? { ttl: 15_000, limit: 5 };
    const increment = vi.fn((_key: string, ttl: number, limit: number) =>
      Promise.resolve({
        totalHits: options?.blocked === true ? limit + 1 : 1,
        timeToExpire: ttl,
        isBlocked: options?.blocked === true,
        timeToBlockExpire: options?.blocked === true ? ttl : 0,
      }),
    );
    const runtimeConfig: RuntimeConfigPort = {
      getSnapshot: () => createSnapshot(published.ttl, published.limit),
      getVersion: () => 'test#1',
      applyDocument: vi.fn(),
      subscribe: () => vi.fn(),
    };
    const guard = new RuntimeThrottlerGuard(
      { throttlers: [{ ttl: 60_000, limit: 100 }] },
      { increment } as unknown as ThrottlerStorage,
      new Reflector(),
      runtimeConfig,
    );

    return {
      guard,
      increment,
      publish: (ttl: number, limit: number) => {
        published.ttl = ttl;
        published.limit = limit;
      },
    };
  }

  it('uses the snapshot ttl and limit for the request', async () => {
    const { guard, increment } = createHarness();
    await guard.onModuleInit();

    await expect(guard.canActivate(createContext())).resolves.toBe(true);

    expect(increment.mock.calls[0]![1]).toBe(15_000);
    expect(increment.mock.calls[0]![2]).toBe(5);
  });

  it('uses a new snapshot on the next request', async () => {
    const { guard, increment, publish } = createHarness();
    await guard.onModuleInit();
    await guard.canActivate(createContext());
    publish(30_000, 2);

    await guard.canActivate(createContext());

    expect(increment.mock.calls[1]![1]).toBe(30_000);
    expect(increment.mock.calls[1]![2]).toBe(2);
  });

  it('throws 429 when the published limit is exceeded', async () => {
    const { guard } = createHarness({ blocked: true });
    await guard.onModuleInit();

    await expect(guard.canActivate(createContext())).rejects.toMatchObject({
      status: 429,
    });
  });

  it('falls back to the module options without a runtime-config service', async () => {
    const increment = vi
      .fn()
      .mockResolvedValue({ totalHits: 1, isBlocked: false });
    const guard = new RuntimeThrottlerGuard(
      options,
      { increment } as unknown as ThrottlerStorage,
      new Reflector(),
    );
    await guard.onModuleInit();

    await guard.canActivate(createContext());

    expect(increment.mock.calls[0]![1]).toBe(60_000);
    expect(increment.mock.calls[0]![2]).toBe(100);
  });

  describe('THROTTLE_DISABLED', () => {
    const original = process.env[EnvKey.THROTTLE_DISABLED];

    afterEach(() => {
      // 不用 `delete process.env[...]`（oxlint 的 no-dynamic-delete）：赋 `undefined`
      // 在 Node 里同样让该键“不存在”，`process.env.X === undefined` 成立。
      process.env[EnvKey.THROTTLE_DISABLED] = original;
    });

    it('skips the guard entirely, never touching storage', async () => {
      process.env[EnvKey.THROTTLE_DISABLED] = 'true';
      const { guard, increment } = createHarness({ blocked: true });
      await guard.onModuleInit();

      await expect(guard.canActivate(createContext())).resolves.toBe(true);
      // 即使快照里配额已被打满（harness 的 blocked=true 会得到 429），
      // 这个开关也必须让请求直接通过，且不产生任何计数。
      expect(increment).not.toHaveBeenCalled();
    });

    it('keeps enforcing the limit when explicitly false', async () => {
      process.env[EnvKey.THROTTLE_DISABLED] = 'false';
      const { guard, increment } = createHarness();
      await guard.onModuleInit();

      await expect(guard.canActivate(createContext())).resolves.toBe(true);
      expect(increment).toHaveBeenCalledTimes(1);
    });

    it('keeps enforcing the limit when unset', async () => {
      process.env[EnvKey.THROTTLE_DISABLED] = undefined;
      const { guard } = createHarness({ blocked: true });
      await guard.onModuleInit();

      await expect(guard.canActivate(createContext())).rejects.toMatchObject({
        status: 429,
      });
    });
  });
});
