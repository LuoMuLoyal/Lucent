import { registerAs } from '@nestjs/config';
import { ConfigKey } from '../env/config-keys.enum.js';
import { EnvKey } from '../env/env-keys.enum.js';

/**
 * Sentinel value used in `.env*` templates to mark an OAuth provider as
 * intentionally disabled (e.g. WeChat mobile while its code stays wired but
 * the UI hides the entry point). A non-empty string would otherwise pass the
 * providers' "not configured" guards and cause them to call the upstream API
 * with a bogus app id/secret.
 */
const NOT_CONFIGURED = 'not-configured';

function resolveCredential(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed.toLowerCase() === NOT_CONFIGURED ? '' : trimmed;
}

export interface OAuthProviderConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export interface OAuthConfig {
  wechatWeb: OAuthProviderConfig;
  wechatMobile: Omit<OAuthProviderConfig, 'redirectUri'>;
  apple: {
    appId: string;
    clientSecret: string;
    jwksUrl: string;
    issuer: string;
  };
  qq: OAuthProviderConfig;
  weibo: OAuthProviderConfig;
  google: OAuthProviderConfig;
}

export const oauthConfig = registerAs(
  ConfigKey.OAuth,
  (): OAuthConfig => ({
    wechatWeb: {
      appId: resolveCredential(process.env[EnvKey.WECHAT_WEB_APP_ID]),
      appSecret: resolveCredential(process.env[EnvKey.WECHAT_WEB_APP_SECRET]),
      redirectUri: process.env[EnvKey.WECHAT_WEB_REDIRECT_URI] ?? '',
    },
    wechatMobile: {
      appId: resolveCredential(process.env[EnvKey.WECHAT_MOBILE_APP_ID]),
      appSecret: resolveCredential(
        process.env[EnvKey.WECHAT_MOBILE_APP_SECRET],
      ),
    },
    apple: {
      appId: resolveCredential(process.env[EnvKey.APPLE_APP_ID]),
      clientSecret: resolveCredential(process.env[EnvKey.APPLE_CLIENT_SECRET]),
      jwksUrl: 'https://appleid.apple.com/auth/keys',
      issuer: 'https://appleid.apple.com',
    },
    qq: {
      appId: resolveCredential(process.env[EnvKey.QQ_APP_ID]),
      appSecret: resolveCredential(process.env[EnvKey.QQ_APP_SECRET]),
      redirectUri: process.env[EnvKey.QQ_REDIRECT_URI] ?? '',
    },
    weibo: {
      appId: resolveCredential(process.env[EnvKey.WEIBO_APP_ID]),
      appSecret: resolveCredential(process.env[EnvKey.WEIBO_APP_SECRET]),
      redirectUri: process.env[EnvKey.WEIBO_REDIRECT_URI] ?? '',
    },
    google: {
      appId: resolveCredential(process.env[EnvKey.GOOGLE_CLIENT_ID]),
      appSecret: resolveCredential(process.env[EnvKey.GOOGLE_CLIENT_SECRET]),
      redirectUri: process.env[EnvKey.GOOGLE_REDIRECT_URI] ?? '',
    },
  }),
);
