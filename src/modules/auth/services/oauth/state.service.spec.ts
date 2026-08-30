import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';

import { AuthOAuthStateService, type OAuthStateEntry } from './state.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { DEFAULT_OAUTH_STATE_TTL_MS } from '../../../../config/app-defaults.constants';
import { loadYamlConfig } from '../../../../config/yaml/yaml-loader';
import type { DomainFailure, ResultAsync } from '../../../../common/result';

// ── Fixtures ──────────────────────────────────────────────────

function buildEntry(overrides: Partial<OAuthStateEntry> = {}): OAuthStateEntry {
  return {
    provider: 'wechat_web',
    purpose: 'login',
    callbackUri: 'https://app.example.com/oauth/callback',
    ...overrides,
  };
}

/** Folds a ResultAsync into a plain outcome so specs can assert code/value. */
function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

// ── Suite ─────────────────────────────────────────────────────

describe('AuthOAuthStateService', () => {
  let service: AuthOAuthStateService;
  let cache: vi.Mocked<Cache>;

  beforeEach(async () => {
    const mockConfigService = {
      get: vi.fn((key: string, fallback?: unknown) => {
        if (key === 'app.corsOrigin') return false;
        return fallback;
      }),
      getOrThrow: vi.fn((key: string) => {
        if (key === 'yaml') return loadYamlConfig();
        throw new Error(`Missing config: ${key}`);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthOAuthStateService,
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: vi.fn(),
            set: vi.fn(),
            del: vi.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get(AuthOAuthStateService);
    cache = module.get(CACHE_MANAGER);

    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue(undefined);
    cache.del.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // ════════════════════════════════════════════════════════════
  // createState
  // ════════════════════════════════════════════════════════════

  describe('createState', () => {
    it('should create a state entry with random token and return ttl', async () => {
      const outcome = await collectResult(
        service.createState('wechat_web', 'login'),
      );

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.value.state).toBeTruthy();
      expect(outcome.value.state.length).toBeGreaterThanOrEqual(32);
      expect(outcome.value.ttlSec).toBe(
        Math.floor(DEFAULT_OAUTH_STATE_TTL_MS / 1000),
      );
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining('auth:oauth-state:'),
        expect.objectContaining({ purpose: 'login' }),
        DEFAULT_OAUTH_STATE_TTL_MS,
      );
    });

    it('should include callbackUri when provided for login purpose', async () => {
      // createState stores callbackUri in the cache entry
      await service.createState(
        'wechat_web',
        'login',
        'http://localhost:3000/oauth/callback',
      );

      expect(cache.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          purpose: 'login',
        }),
        DEFAULT_OAUTH_STATE_TTL_MS,
      );
    });

    it('should create state for link purpose', async () => {
      const outcome = await collectResult(service.createState('apple', 'link'));

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.value.state).toBeTruthy();
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining('auth:oauth-state:'),
        expect.objectContaining({ purpose: 'link' }),
        DEFAULT_OAUTH_STATE_TTL_MS,
      );
    });

    it('should return VALIDATION_FAILED for an invalid callback URI', async () => {
      const outcome = await collectResult(
        service.createState('wechat_web', 'login', 'not-a-url'),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      });
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('should rethrow cache failures instead of masking them as state errors', async () => {
      cache.set.mockRejectedValue(new Error('redis connection lost'));

      await expect(
        collectResult(service.createState('wechat_web', 'login')),
      ).rejects.toThrow('redis connection lost');
    });
  });

  // ════════════════════════════════════════════════════════════
  // peek
  // ════════════════════════════════════════════════════════════

  describe('peek', () => {
    it('should return entry without consuming it', async () => {
      const entry = buildEntry();
      cache.get.mockResolvedValue(entry);

      const outcome = await collectResult(
        service.peek('wechat_web', 'random-state-token'),
      );

      expect(outcome).toEqual({ ok: true, value: entry });
      expect(cache.del).not.toHaveBeenCalled();
    });

    it('should return AUTH_OAUTH_STATE_INVALID when state does not exist', async () => {
      const outcome = await collectResult(
        service.peek('wechat_web', 'nonexistent'),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_OAUTH_STATE_INVALID',
        }),
      });
    });

    it('should return AUTH_OAUTH_STATE_INVALID when provider does not match', async () => {
      cache.get.mockResolvedValue(buildEntry({ provider: 'qq' }));

      const outcome = await collectResult(
        service.peek('wechat_web', 'random-state-token'),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_OAUTH_STATE_INVALID',
        }),
      });
    });

    it('should rethrow cache failures instead of masking them as state errors', async () => {
      cache.get.mockRejectedValue(new Error('redis connection lost'));

      await expect(
        collectResult(service.peek('wechat_web', 'state')),
      ).rejects.toThrow('redis connection lost');
    });
  });

  // ════════════════════════════════════════════════════════════
  // consume
  // ════════════════════════════════════════════════════════════

  describe('consume', () => {
    it('should consume valid state and delete from cache', async () => {
      const entry = buildEntry();
      cache.get.mockResolvedValue(entry);

      const outcome = await collectResult(
        service.consume('wechat_web', 'random-state-token', 'login'),
      );

      expect(outcome).toEqual({ ok: true, value: entry });
      expect(cache.del).toHaveBeenCalled();
    });

    it('should return AUTH_OAUTH_STATE_INVALID when state does not exist', async () => {
      const outcome = await collectResult(
        service.consume('wechat_web', 'nonexistent', 'login'),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_OAUTH_STATE_INVALID',
        }),
      });
    });

    it('should return AUTH_OAUTH_STATE_INVALID when purpose does not match', async () => {
      const entry = buildEntry({ purpose: 'login' });
      cache.get.mockResolvedValue(entry);

      const outcome = await collectResult(
        service.consume('wechat_web', 'random-state-token', 'link'),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_OAUTH_STATE_INVALID',
        }),
      });
    });

    it('should return AUTH_OAUTH_STATE_INVALID on repeated consumption of the same state', async () => {
      // First consumption deletes the entry; a second consume finds nothing.
      cache.get.mockResolvedValueOnce(buildEntry());
      const first = await collectResult(
        service.consume('wechat_web', 'random-state-token', 'login'),
      );
      expect(first.ok).toBe(true);
      expect(cache.del).toHaveBeenCalledTimes(1);

      const second = await collectResult(
        service.consume('wechat_web', 'random-state-token', 'login'),
      );
      expect(second).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_OAUTH_STATE_INVALID',
        }),
      });
    });

    it('should rethrow cache failures instead of masking them as state errors', async () => {
      cache.get.mockRejectedValue(new Error('redis connection lost'));

      await expect(
        collectResult(service.consume('wechat_web', 'state', 'login')),
      ).rejects.toThrow('redis connection lost');
    });
  });

  // ════════════════════════════════════════════════════════════
  // buildRedirectUrl
  // ════════════════════════════════════════════════════════════

  describe('buildRedirectUrl', () => {
    it('should build redirect URL with code and state params', () => {
      const entry = buildEntry();

      const result = service.buildRedirectUrl(
        entry,
        'auth-code-123',
        'random-state-token',
      );

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value).toContain('https://app.example.com/oauth/callback');
      expect(result.value).toContain('code=auth-code-123');
      expect(result.value).toContain('state=random-state-token');
    });

    it('should return VALIDATION_FAILED when entry has no callbackUri', () => {
      const entry = buildEntry({
        callbackUri: undefined,
      } as unknown as Partial<OAuthStateEntry>);

      const result = service.buildRedirectUrl(entry, 'code', 'state');

      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('VALIDATION_FAILED');
    });
  });
});
