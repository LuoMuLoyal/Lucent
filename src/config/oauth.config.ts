import { registerAs } from '@nestjs/config';
import { ConfigKey } from './config-keys.enum';
import { EnvKey } from './env-keys.enum';

export interface OAuthProviderConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export interface OAuthConfig {
  wechatWeb: OAuthProviderConfig;
}

export const oauthConfig = registerAs(
  ConfigKey.OAuth,
  (): OAuthConfig => ({
    wechatWeb: {
      appId: process.env[EnvKey.WECHAT_WEB_APP_ID] ?? '',
      appSecret: process.env[EnvKey.WECHAT_WEB_APP_SECRET] ?? '',
      redirectUri: process.env[EnvKey.WECHAT_WEB_REDIRECT_URI] ?? '',
    },
  }),
);
