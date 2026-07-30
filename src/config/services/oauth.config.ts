import { registerAs } from '@nestjs/config';
import { ConfigKey } from '../env/config-keys.enum';
import { EnvKey } from '../env/env-keys.enum';

export interface OAuthProviderConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export interface OAuthConfig {
  wechatWeb: OAuthProviderConfig;
  wechatMobile: Omit<OAuthProviderConfig, 'redirectUri'>;
  apple: { appId: string; jwksUrl: string; issuer: string };
  qq: OAuthProviderConfig;
  weibo: OAuthProviderConfig;
  google: OAuthProviderConfig;
}

export const oauthConfig = registerAs(
  ConfigKey.OAuth,
  (): OAuthConfig => ({
    wechatWeb: {
      appId: process.env[EnvKey.WECHAT_WEB_APP_ID] ?? '',
      appSecret: process.env[EnvKey.WECHAT_WEB_APP_SECRET] ?? '',
      redirectUri: process.env[EnvKey.WECHAT_WEB_REDIRECT_URI] ?? '',
    },
    wechatMobile: {
      appId: process.env[EnvKey.WECHAT_MOBILE_APP_ID] ?? '',
      appSecret: process.env[EnvKey.WECHAT_MOBILE_APP_SECRET] ?? '',
    },
    apple: {
      appId: process.env[EnvKey.APPLE_APP_ID] ?? '',
      jwksUrl: 'https://appleid.apple.com/auth/keys',
      issuer: 'https://appleid.apple.com',
    },
    qq: {
      appId: process.env[EnvKey.QQ_APP_ID] ?? '',
      appSecret: process.env[EnvKey.QQ_APP_SECRET] ?? '',
      redirectUri: process.env[EnvKey.QQ_REDIRECT_URI] ?? '',
    },
    weibo: {
      appId: process.env[EnvKey.WEIBO_APP_ID] ?? '',
      appSecret: process.env[EnvKey.WEIBO_APP_SECRET] ?? '',
      redirectUri: process.env[EnvKey.WEIBO_REDIRECT_URI] ?? '',
    },
    google: {
      appId: process.env[EnvKey.GOOGLE_CLIENT_ID] ?? '',
      appSecret: process.env[EnvKey.GOOGLE_CLIENT_SECRET] ?? '',
      redirectUri: process.env[EnvKey.GOOGLE_REDIRECT_URI] ?? '',
    },
  }),
);
