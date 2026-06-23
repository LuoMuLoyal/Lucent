import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { I18nService } from 'nestjs-i18n';

import type { OAuthConfig } from '../../../config/oauth.config';
import { OAUTH_PROVIDER_WECHAT_MOBILE } from '../types/oauth.types';
import { WechatMobileOAuthProvider } from './wechat-mobile-oauth.provider';

const mockOAuthConfig: OAuthConfig = {
  wechatWeb: {
    appId: 'wechat-web-app-id',
    appSecret: 'wechat-web-secret',
    redirectUri: 'https://app.example.com/oauth/wechat/callback',
  },
  wechatMobile: {
    appId: 'wechat-mobile-app-id',
    appSecret: 'wechat-mobile-secret',
  },
};

describe('WechatMobileOAuthProvider', () => {
  let provider: WechatMobileOAuthProvider;
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

    provider = new WechatMobileOAuthProvider(
      configService as unknown as ConfigService,
      {
        t: jest.fn((key: string) => key),
      } as unknown as I18nService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should throw when WeChat mobile config is incomplete', async () => {
    configService.getOrThrow.mockReturnValue({
      ...mockOAuthConfig,
      wechatMobile: {
        appId: '',
        appSecret: '',
      },
    });

    await expect(provider.fetchProfile('wechat-code')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('should exchange mobile code for a normalized profile', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'wechat-access-token',
            expires_in: 7200,
            refresh_token: 'wechat-refresh-token',
            openid: 'wechat-mobile-openid-1',
            scope: 'snsapi_userinfo',
            unionid: 'wechat-unionid-1',
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            openid: 'wechat-mobile-openid-1',
            nickname: 'WechatMobileUser',
            headimgurl: 'https://example.com/mobile-avatar.png',
            unionid: 'wechat-unionid-1',
          }),
      } as Response);

    const profile = await provider.fetchProfile('wechat-mobile-code');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(profile).toEqual({
      provider: OAUTH_PROVIDER_WECHAT_MOBILE,
      providerUserId: 'wechat-mobile-openid-1',
      unionId: 'wechat-unionid-1',
      email: null,
      nickname: 'WechatMobileUser',
      avatar: 'https://example.com/mobile-avatar.png',
      rawProfile: {
        token: {
          openid: 'wechat-mobile-openid-1',
          scope: 'snsapi_userinfo',
          unionid: 'wechat-unionid-1',
          expires_in: 7200,
        },
        userInfo: {
          openid: 'wechat-mobile-openid-1',
          nickname: 'WechatMobileUser',
          headimgurl: 'https://example.com/mobile-avatar.png',
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
