import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { OAuthConfig } from '../../../../config/services/oauth.config';
import { OAUTH_PROVIDER_WECHAT_WEB } from '../../types/oauth.types';
import { WechatWebOAuthProvider } from './wechat-web-oauth.provider';
import type { DomainFailure, ResultAsync } from '../../../../common/result';

const mockOAuthConfig: OAuthConfig = {
  wechatWeb: {
    appId: 'wechat-app-id',
    appSecret: 'wechat-secret',
    redirectUri: 'https://app.example.com/oauth/wechat/callback',
  },
  wechatMobile: {
    appId: 'wechat-mobile-app-id',
    appSecret: 'wechat-mobile-secret',
  },
  apple: {
    appId: 'apple-app-id',
    clientSecret: 'apple-client-secret',
    jwksUrl: 'https://appleid.apple.com/auth/keys',
    issuer: 'https://appleid.apple.com',
  },
  qq: {
    appId: 'qq-app-id',
    appSecret: 'qq-secret',
    redirectUri: 'https://app.example.com/oauth/qq/callback',
  },
  weibo: {
    appId: 'weibo-app-id',
    appSecret: 'weibo-secret',
    redirectUri: 'https://app.example.com/oauth/weibo/callback',
  },
  google: {
    appId: 'google-client-id',
    appSecret: 'google-client-secret',
    redirectUri: 'https://app.example.com/oauth/google/callback',
  },
};

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

describe('WechatWebOAuthProvider', () => {
  let provider: WechatWebOAuthProvider;
  let configService: {
    getOrThrow: vi.Mock;
  };

  beforeEach(() => {
    configService = {
      getOrThrow: vi.fn((key: string) => {
        if (key === 'oauth') {
          return mockOAuthConfig;
        }
        throw new Error(`unexpected config key: ${key}`);
      }),
    };

    provider = new WechatWebOAuthProvider(
      configService as unknown as ConfigService,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should build a WeChat QR authorize URL', () => {
    const url = provider.buildAuthorizeUrl('oauth-state');

    expect(url).toContain('https://open.weixin.qq.com/connect/qrconnect?');
    expect(url).toContain('appid=wechat-app-id');
    expect(url).toContain('response_type=code');
    expect(url).toContain('scope=snsapi_login');
    expect(url).toContain('state=oauth-state');
    expect(url).toContain('#wechat_redirect');
  });

  it('should throw when WeChat config is incomplete', () => {
    configService.getOrThrow.mockReturnValue({
      wechatWeb: {
        appId: '',
        appSecret: '',
        redirectUri: '',
      },
      wechatMobile: {
        appId: 'wechat-mobile-app-id',
        appSecret: 'wechat-mobile-secret',
      },
      apple: {
        appId: 'apple-app-id',
        jwksUrl: 'https://appleid.apple.com/auth/keys',
        issuer: 'https://appleid.apple.com',
      },
      qq: {
        appId: 'qq-app-id',
        appSecret: 'qq-secret',
        redirectUri: 'https://app.example.com/oauth/qq/callback',
      },
    });

    expect(() => provider.buildAuthorizeUrl('oauth-state')).toThrow(
      ServiceUnavailableException,
    );
  });

  it('should exchange code for a normalized profile', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'wechat-access-token',
            expires_in: 7200,
            refresh_token: 'wechat-refresh-token',
            openid: 'wechat-openid-1',
            scope: 'snsapi_login',
            unionid: 'wechat-unionid-1',
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            openid: 'wechat-openid-1',
            nickname: 'WechatUser',
            headimgurl: 'https://example.com/avatar.png',
            unionid: 'wechat-unionid-1',
          }),
      } as Response);

    const profile = await expectOk(
      provider.fetchProfile({ code: 'wechat-code' }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(profile).toEqual({
      provider: OAUTH_PROVIDER_WECHAT_WEB,
      providerUserId: 'wechat-openid-1',
      unionId: 'wechat-unionid-1',
      email: null,
      nickname: 'WechatUser',
      avatar: 'https://example.com/avatar.png',
      rawProfile: {
        token: {
          openid: 'wechat-openid-1',
          scope: 'snsapi_login',
          unionid: 'wechat-unionid-1',
          expires_in: 7200,
        },
        userInfo: {
          openid: 'wechat-openid-1',
          nickname: 'WechatUser',
          headimgurl: 'https://example.com/avatar.png',
          unionid: 'wechat-unionid-1',
        },
      },
    });
  });

  it('should return DEPENDENCY_BAD_GATEWAY for WeChat errcode responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          errcode: 40029,
          errmsg: 'invalid code',
        }),
    } as Response);

    await expectErr(
      provider.fetchProfile({ code: 'bad-code' }),
      'DEPENDENCY_BAD_GATEWAY',
    );
  });

  it('should return DEPENDENCY_BAD_GATEWAY when the token response lacks openid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'wechat-access-token',
          expires_in: 7200,
          refresh_token: 'wechat-refresh-token',
          scope: 'snsapi_login',
        }),
    } as Response);

    await expectErr(
      provider.fetchProfile({ code: 'wechat-code' }),
      'DEPENDENCY_BAD_GATEWAY',
    );
  });

  it('should return DEPENDENCY_BAD_GATEWAY when the token response has an empty openid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'wechat-access-token',
          expires_in: 7200,
          refresh_token: 'wechat-refresh-token',
          openid: '',
          scope: 'snsapi_login',
        }),
    } as Response);

    await expectErr(
      provider.fetchProfile({ code: 'wechat-code' }),
      'DEPENDENCY_BAD_GATEWAY',
    );
  });
});
