import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { I18nService } from 'nestjs-i18n';

import { AuthRateLimitService } from './rate-limit.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ResultCode } from '../../../common/api';

// ── Suite ─────────────────────────────────────────────────────

describe('AuthRateLimitService', () => {
  let service: AuthRateLimitService;
  let cache: jest.Mocked<Cache>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthRateLimitService,
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: I18nService,
          useValue: {
            t: jest.fn((key: string) => key),
          },
        },
      ],
    }).compile();

    service = module.get(AuthRateLimitService);
    cache = module.get(CACHE_MANAGER);

    cache.get.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  // ════════════════════════════════════════════════════════════
  // checkLoginRateLimit
  // ════════════════════════════════════════════════════════════

  describe('checkLoginRateLimit', () => {
    it('should allow login when no previous failures', async () => {
      await expect(
        service.checkLoginRateLimit('test@example.com'),
      ).resolves.toBeUndefined();
    });

    it('should allow login when count is below threshold', async () => {
      cache.get.mockResolvedValue({
        count: 5,
        resetAt: Date.now() + 600_000,
      });

      await expect(
        service.checkLoginRateLimit('test@example.com'),
      ).resolves.toBeUndefined();
    });

    it('should reject when account is in lockout period', async () => {
      cache.get.mockResolvedValue({
        count: 5,
        resetAt: Date.now() + 600_000,
        lockedUntil: Date.now() + 1_800_000,
      });

      await expect(
        service.checkLoginRateLimit('test@example.com'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should include correct ResultCode in lockout rejection', async () => {
      cache.get.mockResolvedValue({
        count: 5,
        resetAt: Date.now() + 600_000,
        lockedUntil: Date.now() + 1_800_000,
      });

      try {
        await service.checkLoginRateLimit('test@example.com');
        fail('Expected UnauthorizedException');
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        const response = (error as UnauthorizedException).getResponse() as {
          code: number;
        };
        expect(response.code).toBe(ResultCode.LOGIN_RATE_LIMITED);
      }
    });
  });

  // ════════════════════════════════════════════════════════════
  // recordLoginFailure
  // ════════════════════════════════════════════════════════════

  describe('recordLoginFailure', () => {
    it('should create initial failure bucket on first failure', async () => {
      await service.recordLoginFailure('test@example.com');

      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining('login-failure'),
        expect.objectContaining({ count: 1 }),
        expect.any(Number),
      );
    });

    it('should increment existing failure count', async () => {
      const existing = { count: 3, resetAt: Date.now() + 600_000 };
      cache.get.mockResolvedValue(existing);

      await service.recordLoginFailure('test@example.com');

      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining('login-failure'),
        expect.objectContaining({ count: 4 }),
        expect.any(Number),
      );
    });

    it('should set lockout when count reaches max', async () => {
      const existing = { count: 9, resetAt: Date.now() + 600_000 };
      cache.get.mockResolvedValue(existing);

      await service.recordLoginFailure('test@example.com');

      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining('login-failure'),
        expect.objectContaining({
          count: 10,
          lockedUntil: expect.any(Number),
        }),
        expect.any(Number),
      );
    });
  });

  // ════════════════════════════════════════════════════════════
  // clearLoginFailures
  // ════════════════════════════════════════════════════════════

  describe('clearLoginFailures', () => {
    it('should delete failure cache entry on successful login', async () => {
      await service.clearLoginFailures('test@example.com');

      expect(cache.del).toHaveBeenCalledWith(
        expect.stringContaining('login-failure'),
      );
    });
  });
});
