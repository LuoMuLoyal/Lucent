import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { I18nService } from 'nestjs-i18n';

import type { OAuthConfig } from '../../config/oauth.config';
import { OAUTH_PROVIDER_WECHAT_WEB } from './oauth.types';
import { WechatWebOAuthProvider } from './wechat-web-oauth.provider';

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
};

describe('WechatWebOAuthProvider', () => {
  let provider: WechatWebOAuthProvider;
  let configService: {
    getOrThrow: jest.Mock;
  };

  beforeEach(() => {
    configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'oauth') {
          return mockOAuthConfig;
        }
        throw new Error(`unexpected config key: ${key}`);
      }),
    };

    provider = new WechatWebOAuthProvider(
      configService as unknown as ConfigService,
      {
        t: jest.fn((key: string) => key),
      } as unknown as I18nService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
    });

    expect(() => provider.buildAuthorizeUrl('oauth-state')).toThrow(
      ServiceUnavailableException,
    );
  });

  it('should exchange code for a normalized profile', async () => {
    const fetchMock = jest
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

    const profile = await provider.fetchProfile('wechat-code');

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

  it('should reject WeChat errcode responses', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          errcode: 40029,
          errmsg: 'invalid code',
        }),
    } as Response);

    await expect(provider.fetchProfile('bad-code')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
