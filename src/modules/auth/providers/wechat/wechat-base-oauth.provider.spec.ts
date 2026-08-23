import type { Logger } from '@nestjs/common';
import {
  WechatBaseOAuthProvider,
  type WechatAccessTokenSuccess,
  type WechatErrorResponse,
} from './wechat-base-oauth.provider';
import type { DomainFailure, ResultAsync } from '../../../../common/result';

// Create a concrete subclass for testing the abstract base
class TestWechatProvider extends WechatBaseOAuthProvider {
  readonly provider = 'wechat_web' as const;
  protected readonly logger: Logger = {
    error: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    fatal: vi.fn(),
    setContext: vi.fn(),
  } as unknown as Logger;

  // Expose protected methods for testing
  testFetchWechat<T>(url: string) {
    return this.fetchWechat<T>(url);
  }

  testIsWechatError(payload: unknown): payload is WechatErrorResponse {
    return this.isWechatError(payload);
  }

  testToJsonValue(value: unknown) {
    return this.toJsonValue(value);
  }
}

async function expectOk<T>(result: ResultAsync<T, DomainFailure>): Promise<T> {
  const outcome = await result;
  expect(outcome.isOk()).toBe(true);
  if (outcome.isErr()) throw new Error(`Unexpected Err: ${outcome.error.code}`);
  return outcome.value;
}

async function expectErr(
  result: ResultAsync<unknown, DomainFailure>,
  code: string,
): Promise<void> {
  const outcome = await result;
  expect(outcome.isErr()).toBe(true);
  if (outcome.isOk()) throw new Error('Unexpected Ok');
  expect(outcome.error.code).toBe(code);
}

describe('WechatBaseOAuthProvider', () => {
  let provider: TestWechatProvider;

  beforeEach(() => {
    provider = new TestWechatProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockData),
      });

      const result = await expectOk(
        provider.testFetchWechat<WechatAccessTokenSuccess>(
          'https://api.weixin.qq.com/test',
        ),
      );

      expect(result).toEqual(mockData);
    });

    it('returns DEPENDENCY_UNAVAILABLE when fetch throws', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await expectErr(
        provider.testFetchWechat('https://api.weixin.qq.com/test'),
        'DEPENDENCY_UNAVAILABLE',
      );
    });

    it('returns DEPENDENCY_TIMEOUT when the upstream call times out', async () => {
      const timeoutError = new Error('connect timeout');
      timeoutError.name = 'TimeoutError';
      global.fetch = vi.fn().mockRejectedValue(timeoutError);

      await expectErr(
        provider.testFetchWechat('https://api.weixin.qq.com/test'),
        'DEPENDENCY_TIMEOUT',
      );
    });

    it('returns DEPENDENCY_BAD_GATEWAY when response is not ok', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expectErr(
        provider.testFetchWechat('https://api.weixin.qq.com/test'),
        'DEPENDENCY_BAD_GATEWAY',
      );
    });

    it('returns DEPENDENCY_BAD_GATEWAY when payload is a WeChat error', async () => {
      const errorPayload: WechatErrorResponse = {
        errcode: 40029,
        errmsg: 'invalid code',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(errorPayload),
      });

      await expectErr(
        provider.testFetchWechat('https://api.weixin.qq.com/test'),
        'DEPENDENCY_BAD_GATEWAY',
      );
    });

    it('returns DEPENDENCY_BAD_GATEWAY when the JSON body cannot be decoded', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      });

      await expectErr(
        provider.testFetchWechat('https://api.weixin.qq.com/test'),
        'DEPENDENCY_BAD_GATEWAY',
      );
    });
  });
});
