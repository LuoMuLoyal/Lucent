import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Cache } from 'cache-manager';

import {
  AuthRateLimitService,
  CAPTCHA_THRESHOLD,
} from './rate-limit.service.js';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';

async function inspectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

// ── Suite ─────────────────────────────────────────────────────

describe('AuthRateLimitService', () => {
  let service: AuthRateLimitService;
  let cache: vi.Mocked<Cache>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthRateLimitService,
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: vi.fn(),
            set: vi.fn(),
            del: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(AuthRateLimitService);
    cache = module.get(CACHE_MANAGER);

    cache.get.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // ════════════════════════════════════════════════════════════
  // checkLoginRateLimit
  // ════════════════════════════════════════════════════════════

  describe('checkLoginRateLimit', () => {
    it('should allow login when no previous failures', async () => {
      const result = await inspectResult(
        service.checkLoginRateLimit('test@example.com'),
      );

      expect(result.ok).toBe(true);
    });

    it('should allow login when count is below threshold', async () => {
      cache.get.mockResolvedValue({
        count: 5,
        resetAt: Date.now() + 600_000,
      });

      const result = await inspectResult(
        service.checkLoginRateLimit('test@example.com'),
      );

      expect(result.ok).toBe(true);
    });

    it('should return AUTH_LOGIN_RATE_LIMITED when account is in lockout period', async () => {
      cache.get.mockResolvedValue({
        count: 5,
        resetAt: Date.now() + 600_000,
        lockedUntil: Date.now() + 1_800_000,
      });

      const result = await inspectResult(
        service.checkLoginRateLimit('test@example.com'),
      );

      expect(result).toMatchObject({
        ok: false,
        error: {
          kind: 'rate_limited',
          code: 'AUTH_LOGIN_RATE_LIMITED',
          retryable: true,
          retryAfter: 1800,
          args: { minutes: 30 },
        },
      });
    });

    it('should allow login when lockout period has expired and delete the entry', async () => {
      cache.get.mockResolvedValue({
        count: 10,
        resetAt: Date.now() - 600_000,
        lockedUntil: Date.now() - 1000,
      });

      const result = await inspectResult(
        service.checkLoginRateLimit('test@example.com'),
      );

      expect(result.ok).toBe(true);
      // Should delete the expired entry
      expect(cache.del).toHaveBeenCalledWith(
        expect.stringContaining('login-failure'),
      );
    });

    it('should delete expired bucket and allow login', async () => {
      cache.get.mockResolvedValue({
        count: 3,
        resetAt: Date.now() - 1000,
      });

      const result = await inspectResult(
        service.checkLoginRateLimit('test@example.com'),
      );

      expect(result.ok).toBe(true);
      expect(cache.del).toHaveBeenCalledWith(
        expect.stringContaining('login-failure'),
      );
    });

    it('should delete corrupted bucket and allow login', async () => {
      cache.get.mockResolvedValue({
        wrong: 'shape',
      });

      const result = await inspectResult(
        service.checkLoginRateLimit('test@example.com'),
      );

      expect(result.ok).toBe(true);
      expect(cache.del).toHaveBeenCalledWith(
        expect.stringContaining('login-failure'),
      );
    });

    it('should rethrow cache failures instead of silently allowing login', async () => {
      const error = new Error('cache unavailable');
      cache.get.mockRejectedValue(error);

      await expect(
        service.checkLoginRateLimit('test@example.com').match(
          (value) => value,
          (failure) => failure,
        ),
      ).rejects.toBe(error);
    });
  });

  // ════════════════════════════════════════════════════════════
  // recordLoginFailure
  // ════════════════════════════════════════════════════════════

  describe('recordLoginFailure', () => {
    it('should create initial failure bucket on first failure', async () => {
      const result = await inspectResult(
        service.recordLoginFailure('test@example.com'),
      );

      expect(result.ok).toBe(true);
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining('login-failure'),
        expect.objectContaining({ count: 1 }),
        expect.any(Number),
      );
    });

    it('should increment existing failure count', async () => {
      const existing = { count: 3, resetAt: Date.now() + 600_000 };
      cache.get.mockResolvedValue(existing);

      const result = await inspectResult(
        service.recordLoginFailure('test@example.com'),
      );

      expect(result.ok).toBe(true);
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining('login-failure'),
        expect.objectContaining({ count: 4 }),
        expect.any(Number),
      );
    });

    it('should set lockout when count reaches max', async () => {
      const existing = { count: 9, resetAt: Date.now() + 600_000 };
      cache.get.mockResolvedValue(existing);

      const result = await inspectResult(
        service.recordLoginFailure('test@example.com'),
      );

      expect(result.ok).toBe(true);
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining('login-failure'),
        expect.objectContaining({
          count: 10,
          lockedUntil: expect.any(Number),
        }),
        expect.any(Number),
      );
    });

    it('should reset to count 1 when bucket has expired', async () => {
      cache.get.mockResolvedValue({
        count: 8,
        resetAt: Date.now() - 1000,
      });

      const result = await inspectResult(
        service.recordLoginFailure('test@example.com'),
      );

      expect(result.ok).toBe(true);
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining('login-failure'),
        expect.objectContaining({ count: 1 }),
        expect.any(Number),
      );
    });

    it('should reset to count 1 when bucket has lockedUntil set (already locked)', async () => {
      cache.get.mockResolvedValue({
        count: 10,
        resetAt: Date.now() + 600_000,
        lockedUntil: Date.now() + 1_800_000,
      });

      const result = await inspectResult(
        service.recordLoginFailure('test@example.com'),
      );

      expect(result.ok).toBe(true);
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining('login-failure'),
        expect.objectContaining({ count: 1 }),
        expect.any(Number),
      );
    });

    it('should reset to count 1 when cache returns invalid bucket shape', async () => {
      cache.get.mockResolvedValue({
        wrong: 'shape',
      });

      const result = await inspectResult(
        service.recordLoginFailure('test@example.com'),
      );

      expect(result.ok).toBe(true);
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining('login-failure'),
        expect.objectContaining({ count: 1 }),
        expect.any(Number),
      );
    });

    it('should rethrow cache failures instead of silently swallowing them', async () => {
      const error = new Error('cache unavailable');
      cache.get.mockRejectedValue(error);

      await expect(
        service.recordLoginFailure('test@example.com').match(
          (value) => value,
          (failure) => failure,
        ),
      ).rejects.toBe(error);
    });
  });

  // ════════════════════════════════════════════════════════════
  // clearLoginFailures
  // ════════════════════════════════════════════════════════════

  describe('clearLoginFailures', () => {
    it('should delete failure cache entry on successful login', async () => {
      const result = await inspectResult(
        service.clearLoginFailures('test@example.com'),
      );

      expect(result.ok).toBe(true);
      expect(cache.del).toHaveBeenCalledWith(
        expect.stringContaining('login-failure'),
      );
    });

    it('should hash the email in the cache key', async () => {
      await inspectResult(service.clearLoginFailures('test@example.com'));

      const key = (cache.del as vi.Mock).mock.calls[0]![0] as string;
      // Key should contain a SHA-256 hex digest, not the raw email
      expect(key).not.toContain('test@example.com');
      expect(key).toMatch(/auth:login-failure:[0-9a-f]{64}$/);
    });

    it('should rethrow cache failures instead of silently swallowing them', async () => {
      const error = new Error('cache unavailable');
      cache.del.mockRejectedValue(error);

      await expect(
        service.clearLoginFailures('test@example.com').match(
          (value) => value,
          (failure) => failure,
        ),
      ).rejects.toBe(error);
    });
  });

  describe('isCaptchaRequired', () => {
    const now = Date.now();

    it('should not require a challenge when there are no failures', async () => {
      cache.get.mockResolvedValue(undefined);

      const required = await service
        .isCaptchaRequired('test@example.com')
        .match(
          (value) => value,
          () => true,
        );

      expect(required).toBe(false);
    });

    it('should not require a challenge below CAPTCHA_THRESHOLD', async () => {
      cache.get.mockResolvedValue({
        count: CAPTCHA_THRESHOLD - 1,
        resetAt: now + 60_000,
      });

      const required = await service
        .isCaptchaRequired('test@example.com')
        .match(
          (value) => value,
          () => true,
        );

      expect(required).toBe(false);
    });

    it('should require a challenge once the threshold is reached', async () => {
      cache.get.mockResolvedValue({
        count: CAPTCHA_THRESHOLD,
        resetAt: now + 60_000,
      });

      const required = await service
        .isCaptchaRequired('test@example.com')
        .match(
          (value) => value,
          () => true,
        );

      expect(required).toBe(true);
    });

    it('should forget failures whose window has expired', async () => {
      cache.get.mockResolvedValue({
        count: CAPTCHA_THRESHOLD + 5,
        resetAt: now - 1000,
      });

      const required = await service
        .isCaptchaRequired('test@example.com')
        .match(
          (value) => value,
          () => true,
        );

      expect(required).toBe(false);
    });

    it('should ignore a malformed bucket rather than demanding a challenge', async () => {
      cache.get.mockResolvedValue({ garbage: true });

      const required = await service
        .isCaptchaRequired('test@example.com')
        .match(
          (value) => value,
          () => true,
        );

      expect(required).toBe(false);
    });

    it('should fail open when the cache is unreadable', async () => {
      const error = new Error('cache unavailable');
      cache.get.mockRejectedValue(error);

      await expect(
        service.isCaptchaRequired('test@example.com').match(
          (value) => value,
          (failure) => failure,
        ),
      ).rejects.toBe(error);
    });
  });
});
