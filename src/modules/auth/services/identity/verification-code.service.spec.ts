import { createHash } from 'node:crypto';

import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';

import { VerificationCodeService } from './verification-code.service.js';
import { MailService } from '../../../../mail/mail.service.js';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { RedisService } from '../../../../common/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import { loadYamlConfig } from '../../../../config/yaml/yaml-loader.js';
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
            get: vi.fn((_key: string, fallback?: unknown) => fallback),
            getOrThrow: vi.fn((key: string) => {
              if (key === 'yaml') return loadYamlConfig();
              throw new Error(`Missing config: ${key}`);
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
      // Should set code hash in cache (5 min TTL)
      expect(cache.set).toHaveBeenCalledWith(
        'vcode:register:test@example.com',
        expect.stringMatching(/^[a-f0-9]{64}$/), // SHA256 hex digest
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
      // Simulate a stored hash for code '123456' with scene+email salt
      const storedHash = createHash('sha256')
        .update('register:test@example.com:123456')
        .digest('hex');
      (cache.get as vi.Mock).mockResolvedValue(storedHash);
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
      // Simulate a stored hash for a DIFFERENT code
      const wrongHash = createHash('sha256')
        .update('register:test@example.com:654321')
        .digest('hex');
      (cache.get as vi.Mock).mockResolvedValue(wrongHash);

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
  });

  describe('cache key format', () => {
    it('should use correct cache key format for code', async () => {
      // Simulate a stored hash for code '111111' with scene+email salt
      const storedHash = createHash('sha256')
        .update('login:user@test.com:111111')
        .digest('hex');
      (cache.get as vi.Mock).mockResolvedValue(storedHash);
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
});
