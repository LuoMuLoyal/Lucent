import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';

import { VerificationCodeService } from './verification-code.js';
import { MailService } from '../../../../mail/mail.service.js';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { RedisService } from '../../../../common/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../../../config/runtime/runtime-config.service.js';
import {
  DEFAULT_VERIFICATION_CODE_TTL_MS,
  DEFAULT_VERIFICATION_COOLDOWN_MS,
  DEFAULT_VERIFICATION_RATE_LIMIT_MAX,
  DEFAULT_VERIFICATION_RATE_LIMIT_WINDOW_MS,
} from '../../../../config/app-defaults.constants.js';

async function inspectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

describe('VerificationCodeService', () => {
  let service: VerificationCodeService;
  let cache: vi.Mocked<Cache>;
  let mailService: vi.Mocked<MailService>;
  let redisService: { isAvailable: boolean; atomicIncrement: vi.Mock };

  beforeEach(async () => {
    redisService = {
      isAvailable: false,
      atomicIncrement: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationCodeService,
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: vi.fn(),
            set: vi.fn(),
            del: vi.fn(),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendVerificationCode: vi.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string, fallback?: unknown) => {
              if (key === (EnvKey.VERIFICATION_CODE_TTL_MS as string))
                // Mirrors the zod validation backfill: unset → default.
                return process.env[EnvKey.VERIFICATION_CODE_TTL_MS] ?? '300000';
              if (key === (EnvKey.VERIFICATION_COOLDOWN_MS as string))
                return process.env[EnvKey.VERIFICATION_COOLDOWN_MS] ?? '60000';
              if (key === (EnvKey.VERIFICATION_RATE_LIMIT_WINDOW_MS as string))
                return (
                  process.env[EnvKey.VERIFICATION_RATE_LIMIT_WINDOW_MS] ??
                  '600000'
                );
              if (key === (EnvKey.VERIFICATION_RATE_LIMIT_MAX as string))
                return process.env[EnvKey.VERIFICATION_RATE_LIMIT_MAX] ?? '20';
              if (key === (EnvKey.VERIFICATION_CODE_LENGTH as string))
                return process.env[EnvKey.VERIFICATION_CODE_LENGTH] ?? '6';
              return fallback;
            }),
          },
        },
        {
          provide: RedisService,
          useValue: redisService,
        },
      ],
    }).compile();

    service = module.get(VerificationCodeService);
    cache = module.get(CACHE_MANAGER);
    mailService = module.get(MailService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const envKey of [
      EnvKey.VERIFICATION_CODE_TTL_MS,
      EnvKey.VERIFICATION_COOLDOWN_MS,
      EnvKey.VERIFICATION_RATE_LIMIT_WINDOW_MS,
      EnvKey.VERIFICATION_RATE_LIMIT_MAX,
      EnvKey.VERIFICATION_CODE_LENGTH,
    ]) {
      Reflect.deleteProperty(process.env, envKey);
    }
  });

  describe('send', () => {
    it('should generate code, store in cache, set cooldown, and send email', async () => {
      (cache.get as vi.Mock).mockResolvedValue(undefined); // no cooldown
      (cache.set as vi.Mock).mockResolvedValue(undefined);
      mailService.sendVerificationCode.mockResolvedValue(undefined);

      const result = await inspectResult(
        service.send('test@example.com', 'register'),
      );

      expect(result.ok).toBe(true);
      // 缓存里存的是**聚合状态**（含 attempts），不是裸指纹：ttempts 与码
      // 必须同时成立，放在同一条目里才能原子地作废与清零。
      expect(cache.set).toHaveBeenCalledWith(
        'vcode:register:test@example.com',
        expect.objectContaining({
          scene: 'register',
          email: 'test@example.com',
          codeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          attempts: 0,
        }),
        DEFAULT_VERIFICATION_CODE_TTL_MS,
      );

      // Should set cooldown in cache (60s TTL)
      expect(cache.set).toHaveBeenCalledWith(
        'vcode:cd:register:test@example.com',
        '1',
        DEFAULT_VERIFICATION_COOLDOWN_MS,
      );

      // Should send email
      expect(mailService.sendVerificationCode).toHaveBeenCalledWith(
        'test@example.com',
        expect.stringMatching(/^\d{6}$/),
        undefined,
      );
    });

    it('should return AUTH_VERIFICATION_CODE_COOLDOWN when in cooldown', async () => {
      (cache.get as vi.Mock).mockResolvedValue('1'); // in cooldown

      const result = await inspectResult(
        service.send('test@example.com', 'login'),
      );

      expect(result).toMatchObject({
        ok: false,
        error: {
          kind: 'rate_limited',
          code: 'AUTH_VERIFICATION_CODE_COOLDOWN',
          retryable: true,
          retryAfter: 60,
        },
      });
      expect(mailService.sendVerificationCode).not.toHaveBeenCalled();
    });

    it('should store a client rate limit bucket when client key is provided', async () => {
      (cache.get as vi.Mock).mockResolvedValue(undefined);
      (cache.set as vi.Mock).mockResolvedValue(undefined);
      mailService.sendVerificationCode.mockResolvedValue(undefined);

      const result = await inspectResult(
        service.send('test@example.com', 'register', '127.0.0.1'),
      );

      expect(result.ok).toBe(true);
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringMatching(/^vcode:rl:client:[a-f0-9]{64}$/),
        expect.objectContaining({
          count: 1,
          resetAt: expect.any(Number) as number,
        }),
        DEFAULT_VERIFICATION_RATE_LIMIT_WINDOW_MS,
      );
    });

    it('should return AUTH_VERIFICATION_CODE_RATE_LIMITED when client rate limit is exceeded', async () => {
      const resetAt = Date.now() + 60_000;
      (cache.get as vi.Mock).mockResolvedValue({
        count: DEFAULT_VERIFICATION_RATE_LIMIT_MAX,
        resetAt,
      });

      const result = await inspectResult(
        service.send('test@example.com', 'register', '127.0.0.1'),
      );

      expect(result).toMatchObject({
        ok: false,
        error: {
          kind: 'rate_limited',
          code: 'AUTH_VERIFICATION_CODE_RATE_LIMITED',
          retryable: true,
          retryAfter: 60, // ceil((resetAt - now) / 1000) with resetAt = now + 60s
        },
      });
      expect(mailService.sendVerificationCode).not.toHaveBeenCalled();
    });

    it('should rate-limit even when clientKey is not provided (uses default bucket)', async () => {
      const resetAt = Date.now() + 60_000;
      (cache.get as vi.Mock).mockResolvedValue({
        count: DEFAULT_VERIFICATION_RATE_LIMIT_MAX,
        resetAt,
      });

      const result = await inspectResult(
        service.send('test@example.com', 'register'),
      );

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'AUTH_VERIFICATION_CODE_RATE_LIMITED',
        },
      });
      expect(mailService.sendVerificationCode).not.toHaveBeenCalled();
    });

    it('should create a default rate-limit bucket when clientKey is not provided', async () => {
      (cache.get as vi.Mock).mockResolvedValue(undefined);
      (cache.set as vi.Mock).mockResolvedValue(undefined);
      mailService.sendVerificationCode.mockResolvedValue(undefined);

      const result = await inspectResult(
        service.send('test@example.com', 'register'),
      );

      expect(result.ok).toBe(true);
      const unknownHash = createHash('sha256').update('unknown').digest('hex');
      expect(cache.set).toHaveBeenCalledWith(
        `vcode:rl:client:${unknownHash}`,
        expect.objectContaining({ count: 1 }),
        DEFAULT_VERIFICATION_RATE_LIMIT_WINDOW_MS,
      );
    });

    it('should rethrow cache failures instead of masking them as business failures', async () => {
      const error = new Error('cache unavailable');
      (cache.get as vi.Mock).mockRejectedValue(error);

      await expect(
        service.send('test@example.com', 'register').match(
          (value) => value,
          (failure) => failure,
        ),
      ).rejects.toBe(error);
      expect(mailService.sendVerificationCode).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    it('should return ok(undefined) for correct code and delete from cache', async () => {
      // 模拟一条已签发的挑战状态（含 attempts），指纹按 scene+email 派生。
      const storedState = {
        scene: 'register',
        email: 'test@example.com',
        codeHash: createHash('sha256')
          .update('register:test@example.com:123456')
          .digest('hex'),
        attempts: 0,
        issuedAt: new Date(),
      };
      (cache.get as vi.Mock).mockResolvedValue(storedState);
      (cache.del as vi.Mock).mockResolvedValue(undefined);

      const result = await inspectResult(
        service.verify('test@example.com', '123456', 'register'),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected verify success');
      expect(result.value).toBeUndefined();
      expect(cache.del).toHaveBeenCalledWith('vcode:register:test@example.com');
    });

    it('should return AUTH_VERIFICATION_CODE_EXPIRED if code expired (not in cache)', async () => {
      (cache.get as vi.Mock).mockResolvedValue(undefined);

      const result = await inspectResult(
        service.verify('test@example.com', '123456', 'register'),
      );

      expect(result).toMatchObject({
        ok: false,
        error: {
          kind: 'authentication',
          code: 'AUTH_VERIFICATION_CODE_EXPIRED',
        },
      });
    });

    it('should return AUTH_VERIFICATION_CODE_MISMATCH for wrong code', async () => {
      // 存的是**另一个码**的挑战状态。
      const wrongState = {
        scene: 'register',
        email: 'test@example.com',
        codeHash: createHash('sha256')
          .update('register:test@example.com:654321')
          .digest('hex'),
        attempts: 0,
        issuedAt: new Date(),
      };
      (cache.get as vi.Mock).mockResolvedValue(wrongState);

      const result = await inspectResult(
        service.verify('test@example.com', '123456', 'register'),
      );

      expect(result).toMatchObject({
        ok: false,
        error: {
          kind: 'authentication',
          code: 'AUTH_VERIFICATION_CODE_MISMATCH',
        },
      });
    });

    it('should rethrow cache failures instead of masking them as mismatch', async () => {
      const error = new Error('cache unavailable');
      (cache.get as vi.Mock).mockRejectedValue(error);

      await expect(
        service.verify('test@example.com', '123456', 'register').match(
          (value) => value,
          (failure) => failure,
        ),
      ).rejects.toBe(error);
    });

    // ── 尝试次数上限（本次新增的不变量） ──────────────────────

    /** 构造一条 `attempts` 为指定值的挑战状态。 */
    function challengeState(attempts: number, code = '654321') {
      return {
        scene: 'register',
        email: 'test@example.com',
        codeHash: createHash('sha256')
          .update(`register:test@example.com:${code}`)
          .digest('hex'),
        attempts,
        issuedAt: new Date(),
      };
    }

    it('错码时把递增后的计数写回缓存，且不删除条目', async () => {
      (cache.get as vi.Mock).mockResolvedValue(challengeState(0));

      const result = await inspectResult(
        service.verify('test@example.com', '123456', 'register'),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'AUTH_VERIFICATION_CODE_MISMATCH' },
      });
      expect(cache.del).not.toHaveBeenCalled();
      expect(cache.set).toHaveBeenCalledWith(
        'vcode:register:test@example.com',
        expect.objectContaining({ attempts: 1 }),
        expect.any(Number),
      );
    });

    it('写回用剩余 TTL，不延长码的寿命', async () => {
      // 否则攻击者可以靠不断猜错把码永远留住。
      const stale = challengeState(0);
      stale.issuedAt = new Date(Date.now() - 200_000); // 已过去 200s，TTL 300s
      (cache.get as vi.Mock).mockResolvedValue(stale);

      await inspectResult(
        service.verify('test@example.com', '123456', 'register'),
      );

      const ttl = (cache.set as vi.Mock).mock.calls[0]?.[2] as number;
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(100_000);
    });

    it('第 5 次错码 → AUTH_VERIFICATION_CODE_EXPIRED（不新造错误码）', async () => {
      // 用 EXPIRED 而不是新码：新码会告诉攻击者「你把这码猜爆了」。
      (cache.get as vi.Mock).mockResolvedValue(challengeState(4));

      const result = await inspectResult(
        service.verify('test@example.com', '123456', 'register'),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'AUTH_VERIFICATION_CODE_EXPIRED' },
      });
      expect(cache.set).toHaveBeenCalledWith(
        'vcode:register:test@example.com',
        expect.objectContaining({ attempts: 5 }),
        expect.any(Number),
      );
    });

    it('【核心】猜爆之后，正确的码也不再通过', async () => {
      // 本次行为变更的核心断言。若实现成「作废但仍比对」，攻击者猜满后
      // 仍能靠命中通过，上限就白做了。
      (cache.get as vi.Mock).mockResolvedValue(challengeState(5, '123456'));

      const result = await inspectResult(
        service.verify('test@example.com', '123456', 'register'),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'AUTH_VERIFICATION_CODE_EXPIRED' },
      });
      expect(cache.del).not.toHaveBeenCalled();
    });

    it('猜爆时记 warn（运维可观测），但不泄露剩余次数', async () => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      (cache.get as vi.Mock).mockResolvedValue(challengeState(4));

      await inspectResult(
        service.verify('test@example.com', '123456', 'register'),
      );

      expect(warn).toHaveBeenCalledWith(
        'Verification challenge exhausted',
        expect.objectContaining({ scene: 'register' }),
      );
      // 日志里不能出现剩余次数。
      expect(JSON.stringify(warn.mock.calls)).not.toContain(
        'remainingAttempts',
      );
    });

    it('未到上限时不记 warn', async () => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      (cache.get as vi.Mock).mockResolvedValue(challengeState(0));

      await inspectResult(
        service.verify('test@example.com', '123456', 'register'),
      );

      expect(warn).not.toHaveBeenCalledWith(
        'Verification challenge exhausted',
        expect.anything(),
      );
    });
  });

  describe('cache key format', () => {
    it('should use correct cache key format for code', async () => {
      const storedState = {
        scene: 'login',
        email: 'user@test.com',
        codeHash: createHash('sha256')
          .update('login:user@test.com:111111')
          .digest('hex'),
        attempts: 0,
        issuedAt: new Date(),
      };
      (cache.get as vi.Mock).mockResolvedValue(storedState);
      (cache.del as vi.Mock).mockResolvedValue(undefined);

      const result = await inspectResult(
        service.verify('user@test.com', '111111', 'login'),
      );

      expect(result.ok).toBe(true);
      expect(cache.get).toHaveBeenCalledWith('vcode:login:user@test.com');
      expect(cache.del).toHaveBeenCalledWith('vcode:login:user@test.com');
    });

    it('should use correct cache key format for cooldown', async () => {
      (cache.get as vi.Mock).mockResolvedValue(undefined);
      (cache.set as vi.Mock).mockResolvedValue(undefined);
      mailService.sendVerificationCode.mockResolvedValue(undefined);

      await inspectResult(service.send('user@test.com', 'delete-account'));

      expect(cache.get).toHaveBeenCalledWith(
        'vcode:cd:delete-account:user@test.com',
      );
    });
  });

  describe('assertClientRateLimit — Redis atomic path', () => {
    beforeEach(() => {
      redisService.isAvailable = true;
    });

    it('uses Redis atomicIncrement and allows when under limit', async () => {
      redisService.atomicIncrement.mockResolvedValueOnce(1);
      (cache.get as vi.Mock).mockResolvedValue(undefined);
      (cache.set as vi.Mock).mockResolvedValue(undefined);
      mailService.sendVerificationCode.mockResolvedValue(undefined);

      const result = await inspectResult(
        service.send('test@example.com', 'register', '127.0.0.1'),
      );

      expect(result.ok).toBe(true);
      expect(redisService.atomicIncrement).toHaveBeenCalledWith(
        expect.stringMatching(/^vcode:rl:client:[a-f0-9]{64}$/),
        DEFAULT_VERIFICATION_RATE_LIMIT_WINDOW_MS,
      );
      // Should NOT use cache-based rate-limit path
      expect(cache.get).not.toHaveBeenCalledWith(
        expect.stringMatching(/^vcode:rl:client:/),
      );
    });

    it('returns AUTH_VERIFICATION_CODE_RATE_LIMITED when Redis count exceeds max requests', async () => {
      redisService.atomicIncrement.mockResolvedValueOnce(
        DEFAULT_VERIFICATION_RATE_LIMIT_MAX + 1,
      );

      const result = await inspectResult(
        service.send('test@example.com', 'register', '127.0.0.1'),
      );

      expect(result).toMatchObject({
        ok: false,
        error: {
          kind: 'rate_limited',
          code: 'AUTH_VERIFICATION_CODE_RATE_LIMITED',
          retryable: true,
          retryAfter: Math.ceil(
            DEFAULT_VERIFICATION_RATE_LIMIT_WINDOW_MS / 1000,
          ),
        },
      });
      expect(mailService.sendVerificationCode).not.toHaveBeenCalled();
    });

    it('uses default bucket key when clientKey is not provided', async () => {
      redisService.atomicIncrement.mockResolvedValueOnce(1);
      (cache.get as vi.Mock).mockResolvedValue(undefined);
      (cache.set as vi.Mock).mockResolvedValue(undefined);
      mailService.sendVerificationCode.mockResolvedValue(undefined);

      const result = await inspectResult(
        service.send('test@example.com', 'register'),
      );

      expect(result.ok).toBe(true);
      const unknownHash = createHash('sha256').update('unknown').digest('hex');
      expect(redisService.atomicIncrement).toHaveBeenCalledWith(
        `vcode:rl:client:${unknownHash}`,
        DEFAULT_VERIFICATION_RATE_LIMIT_WINDOW_MS,
      );
    });

    it('rethrows Redis failures instead of masking them as business failures', async () => {
      const error = new Error('redis unavailable');
      redisService.atomicIncrement.mockRejectedValueOnce(error);

      await expect(
        service.send('test@example.com', 'register', '127.0.0.1').match(
          (value) => value,
          (failure) => failure,
        ),
      ).rejects.toBe(error);
      expect(mailService.sendVerificationCode).not.toHaveBeenCalled();
    });
  });

  describe('constructor sanity checks', () => {
    const YAML_KEY_TO_ENV_KEY: Record<string, EnvKey> = {
      codeTtlMs: EnvKey.VERIFICATION_CODE_TTL_MS,
      cooldownMs: EnvKey.VERIFICATION_COOLDOWN_MS,
      rateLimitWindowMs: EnvKey.VERIFICATION_RATE_LIMIT_WINDOW_MS,
      rateLimitMax: EnvKey.VERIFICATION_RATE_LIMIT_MAX,
      codeLength: EnvKey.VERIFICATION_CODE_LENGTH,
    };

    async function createServiceWithOverrides(
      overrides: Record<string, number>,
    ) {
      // Map YAML-style keys to env vars
      for (const [yamlKey, value] of Object.entries(overrides)) {
        const envKey = YAML_KEY_TO_ENV_KEY[yamlKey];
        if (envKey) {
          process.env[envKey] = String(value);
        }
      }

      const service = (
        await Test.createTestingModule({
          providers: [
            VerificationCodeService,
            {
              provide: CACHE_MANAGER,
              useValue: {
                get: vi.fn(),
                set: vi.fn(),
                del: vi.fn(),
              },
            },
            {
              provide: MailService,
              useValue: { sendVerificationCode: vi.fn() },
            },
            {
              provide: ConfigService,
              useValue: {
                get: vi.fn((key: string, fallback?: unknown) => {
                  return process.env[key] ?? fallback;
                }),
              },
            },
            {
              provide: RedisService,
              useValue: { isAvailable: false, atomicIncrement: vi.fn() },
            },
          ],
        }).compile()
      ).get<VerificationCodeService>(VerificationCodeService);

      return service;
    }

    it('rejects when codeTtlMs is zero', async () => {
      await expect(
        createServiceWithOverrides({ codeTtlMs: 0 }),
      ).rejects.toThrow('codeTtlMs must be positive');
    });

    it('rejects when cooldownMs is negative', async () => {
      await expect(
        createServiceWithOverrides({ cooldownMs: -1 }),
      ).rejects.toThrow('cooldownMs must be positive');
    });

    it('rejects when cooldownMs exceeds codeTtlMs', async () => {
      await expect(
        createServiceWithOverrides({ codeTtlMs: 30_000, cooldownMs: 60_000 }),
      ).rejects.toThrow('cooldownMs');
    });

    it('rejects when rateLimitMax is zero', async () => {
      await expect(
        createServiceWithOverrides({ rateLimitMax: 0 }),
      ).rejects.toThrow('rateLimitMax must be positive');
    });
  });
});

describe('VerificationCodeService runtime overrides', () => {
  function buildModule(values: Record<string, unknown>) {
    const cache = {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      del: vi.fn().mockResolvedValue(undefined),
    };
    const mail = { sendVerificationCode: vi.fn().mockResolvedValue(undefined) };
    return Test.createTestingModule({
      providers: [
        VerificationCodeService,
        { provide: CACHE_MANAGER, useValue: cache },
        { provide: MailService, useValue: mail },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string, fallback?: unknown) => {
              const defaults: Record<string, string> = {
                [EnvKey.VERIFICATION_CODE_TTL_MS]: '300000',
                [EnvKey.VERIFICATION_COOLDOWN_MS]: '60000',
                [EnvKey.VERIFICATION_RATE_LIMIT_WINDOW_MS]: '600000',
                [EnvKey.VERIFICATION_RATE_LIMIT_MAX]: '20',
                [EnvKey.VERIFICATION_CODE_LENGTH]: '6',
              };
              return defaults[key] ?? fallback;
            }),
          },
        },
        {
          provide: RedisService,
          useValue: { isAvailable: false, atomicIncrement: vi.fn() },
        },
        {
          provide: RuntimeConfigService,
          useValue: { getSnapshot: () => ({ values }) },
        },
      ],
    })
      .compile()
      .then((module) => ({
        service: module.get(VerificationCodeService),
        cache,
        mail,
      }));
  }

  it('uses the published TTL, cooldown and code length for the next code', async () => {
    const { service, cache, mail } = await buildModule({
      [EnvKey.VERIFICATION_CODE_TTL_MS]: 90_000,
      [EnvKey.VERIFICATION_COOLDOWN_MS]: 30_000,
      [EnvKey.VERIFICATION_CODE_LENGTH]: 8,
    });

    const result = await inspectResult(service.send('a@b.example', 'login'));

    expect(result.ok).toBe(true);
    expect(cache.set).toHaveBeenCalledWith(
      'vcode:login:a@b.example',
      expect.objectContaining({
        codeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        attempts: 0,
      }),
      90_000,
    );
    expect(cache.set).toHaveBeenCalledWith(
      'vcode:cd:login:a@b.example',
      '1',
      30_000,
    );
    expect(mail.sendVerificationCode).toHaveBeenCalledWith(
      'a@b.example',
      expect.stringMatching(/^\d{8}$/),
      undefined,
    );
  });

  it('clamps a published cooldown longer than the code TTL', async () => {
    const { service, cache } = await buildModule({
      [EnvKey.VERIFICATION_CODE_TTL_MS]: 20_000,
      [EnvKey.VERIFICATION_COOLDOWN_MS]: 60_000,
    });

    await inspectResult(service.send('a@b.example', 'login'));

    expect(cache.set).toHaveBeenCalledWith(
      'vcode:cd:login:a@b.example',
      '1',
      20_000,
    );
    expect(service.getCooldownSec()).toBe(20);
  });
});
