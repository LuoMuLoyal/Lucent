import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';

import {
  AuthOAuthStateService,
  OAUTH_STATE_TTL,
  type OAuthStateEntry,
} from './state.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

// ── Fixtures ──────────────────────────────────────────────────

function buildEntry(overrides: Partial<OAuthStateEntry> = {}): OAuthStateEntry {
  return {
    provider: 'wechat_web',
    purpose: 'login',
    callbackUri: 'https://app.example.com/oauth/callback',
    ...overrides,
  };
}

// ── Suite ─────────────────────────────────────────────────────

describe('AuthOAuthStateService', () => {
  let service: AuthOAuthStateService;
  let cache: jest.Mocked<Cache>;

  beforeEach(async () => {
    const mockConfigService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'auth.oauthStateTtl') return OAUTH_STATE_TTL;
        throw new Error(`Unexpected config key: ${key}`);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthOAuthStateService,
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: I18nService,
          useValue: {
            t: jest.fn((key: string) => key),
          },
        },
      ],
    }).compile();

    service = module.get(AuthOAuthStateService);
    cache = module.get(CACHE_MANAGER);

    cache.get.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  // ════════════════════════════════════════════════════════════
  // createState
  // ════════════════════════════════════════════════════════════

  describe('createState', () => {
    it('should create a state entry with random token and return ttl', async () => {
      const result = await service.createState('wechat_web', 'login');

      expect(result.state).toBeTruthy();
      expect(result.state.length).toBeGreaterThanOrEqual(32);
      expect(result.ttlSec).toBe(Math.floor(OAUTH_STATE_TTL / 1000));
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining('auth:oauth-state:'),
        expect.objectContaining({ purpose: 'login' }),
        OAUTH_STATE_TTL,
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
        OAUTH_STATE_TTL,
      );
    });
  });

  // ════════════════════════════════════════════════════════════
  // peek
  // ════════════════════════════════════════════════════════════

  describe('peek', () => {
    it('should return entry without consuming it', async () => {
      const entry = buildEntry();
      cache.get.mockResolvedValue(entry);

      const result = await service.peek('wechat_web', 'random-state-token');

      expect(result).toEqual(entry);
      expect(cache.del).not.toHaveBeenCalled();
    });

    it('should throw when state does not exist', async () => {
      await expect(service.peek('wechat_web', 'nonexistent')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ════════════════════════════════════════════════════════════
  // consume
  // ════════════════════════════════════════════════════════════

  describe('consume', () => {
    it('should consume valid state and delete from cache', async () => {
      const entry = buildEntry();
      cache.get.mockResolvedValue(entry);

      const result = await service.consume(
        'wechat_web',
        'random-state-token',
        'login',
      );

      expect(result).toEqual(entry);
      expect(cache.del).toHaveBeenCalled();
    });

    it('should throw when state does not exist', async () => {
      await expect(
        service.consume('wechat_web', 'nonexistent', 'login'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw when purpose does not match', async () => {
      const entry = buildEntry({ purpose: 'login' });
      cache.get.mockResolvedValue(entry);

      await expect(
        service.consume('wechat_web', 'random-state-token', 'link'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ════════════════════════════════════════════════════════════
  // buildRedirectUrl
  // ════════════════════════════════════════════════════════════

  describe('buildRedirectUrl', () => {
    it('should build redirect URL with code and state params', () => {
      const entry = buildEntry();

      const url = service.buildRedirectUrl(
        entry,
        'auth-code-123',
        'random-state-token',
      );

      expect(url).toContain('https://app.example.com/oauth/callback');
      expect(url).toContain('code=auth-code-123');
      expect(url).toContain('state=random-state-token');
    });

    it('should throw when entry has no callbackUri', () => {
      const entry = buildEntry({
        callbackUri: undefined,
      } as unknown as Partial<OAuthStateEntry>);

      expect(() => service.buildRedirectUrl(entry, 'code', 'state')).toThrow(
        BadRequestException,
      );
    });
  });
});
