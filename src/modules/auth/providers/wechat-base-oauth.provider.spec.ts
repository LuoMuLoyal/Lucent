import { ServiceUnavailableException } from '@nestjs/common';
import type { Logger } from '@nestjs/common';
import type { I18nService } from 'nestjs-i18n';
import {
  WechatBaseOAuthProvider,
  type WechatAccessTokenSuccess,
  type WechatErrorResponse,
} from './wechat-base-oauth.provider';

// Create a concrete subclass for testing the abstract base
class TestWechatProvider extends WechatBaseOAuthProvider {
  readonly provider = 'wechat_web' as const;
  protected readonly logger: Logger = {
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    fatal: jest.fn(),
    setContext: jest.fn(),
  } as unknown as Logger;
  protected readonly i18n: I18nService;

  constructor(i18n: I18nService) {
    super();
    this.i18n = i18n;
  }

  // Expose protected methods for testing
  async testFetchWechat<T>(url: string): Promise<T> {
    return this.fetchWechat<T>(url);
  }

  testIsWechatError(payload: unknown): payload is WechatErrorResponse {
    return this.isWechatError(payload);
  }

  testToJsonValue(value: unknown) {
    return this.toJsonValue(value);
  }
}

describe('WechatBaseOAuthProvider', () => {
  let provider: TestWechatProvider;
  let i18n: jest.Mocked<I18nService>;

  beforeEach(() => {
    i18n = {
      t: jest.fn().mockReturnValue('translated'),
    } as unknown as jest.Mocked<I18nService>;
    provider = new TestWechatProvider(i18n);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isWechatError', () => {
    it('returns true for error payload with errcode', () => {
      expect(
        provider.testIsWechatError({ errcode: 40029, errmsg: 'invalid code' }),
      ).toBe(true);
    });

    it('returns false for success payload', () => {
      expect(
        provider.testIsWechatError({ access_token: 'tok', openid: 'id' }),
      ).toBe(false);
    });

    it('returns false for null', () => {
      expect(provider.testIsWechatError(null)).toBe(false);
    });

    it('returns false for non-object', () => {
      expect(provider.testIsWechatError('string')).toBe(false);
    });

    it('returns false when errcode is not a number', () => {
      expect(provider.testIsWechatError({ errcode: 'not-a-number' })).toBe(
        false,
      );
    });
  });

  describe('toJsonValue', () => {
    it('casts value to InputJsonValue', () => {
      const result = provider.testToJsonValue({ key: 'value' });
      expect(result).toEqual({ key: 'value' });
    });
  });

  describe('fetchWechat', () => {
    it('returns parsed JSON on success', async () => {
      const mockData: WechatAccessTokenSuccess = {
        access_token: 'tok',
        expires_in: 7200,
        refresh_token: 'rt',
        openid: 'openid',
        scope: 'snsapi_userinfo',
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockData),
      });

      const result = await provider.testFetchWechat<WechatAccessTokenSuccess>(
        'https://api.weixin.qq.com/test',
      );

      expect(result).toEqual(mockData);
    });

    it('throws ServiceUnavailableException when fetch throws', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      await expect(
        provider.testFetchWechat('https://api.weixin.qq.com/test'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException when response is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(
        provider.testFetchWechat('https://api.weixin.qq.com/test'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws when payload is a WeChat error', async () => {
      const errorPayload: WechatErrorResponse = {
        errcode: 40029,
        errmsg: 'invalid code',
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(errorPayload),
      });

      await expect(
        provider.testFetchWechat('https://api.weixin.qq.com/test'),
      ).rejects.toThrow();
    });
  });
});
