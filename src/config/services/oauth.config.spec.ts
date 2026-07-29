import { EnvKey } from '../env/env-keys.enum';
import { oauthConfig } from './oauth.config';

describe('oauthConfig', () => {
  const saved: Record<string, string | undefined> = {};
  const keysToClean = [
    EnvKey.WECHAT_WEB_APP_ID,
    EnvKey.WECHAT_WEB_APP_SECRET,
    EnvKey.WECHAT_WEB_REDIRECT_URI,
    EnvKey.WECHAT_MOBILE_APP_ID,
    EnvKey.WECHAT_MOBILE_APP_SECRET,
    EnvKey.APPLE_APP_ID,
    EnvKey.QQ_APP_ID,
    EnvKey.QQ_APP_SECRET,
    EnvKey.QQ_REDIRECT_URI,
  ];

  beforeEach(() => {
    for (const key of keysToClean) {
      saved[key] = process.env[key];
      Reflect.deleteProperty(process.env, key);
    }
  });

  afterEach(() => {
    for (const key of keysToClean) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key];
      } else {
        Reflect.deleteProperty(process.env, key);
      }
    }
  });

  function callFactory() {
    return oauthConfig()!;
  }

  it('returns empty strings for all providers when env vars are absent', () => {
    const config = callFactory();

    expect(config.wechatWeb).toEqual({
      appId: '',
      appSecret: '',
      redirectUri: '',
    });
    expect(config.wechatMobile).toEqual({
      appId: '',
      appSecret: '',
    });
    expect(config.apple.appId).toBe('');
  });

  it('reads wechat web OAuth config from env vars', () => {
    process.env[EnvKey.WECHAT_WEB_APP_ID] = 'wx-web-id';
    process.env[EnvKey.WECHAT_WEB_APP_SECRET] = 'wx-web-secret';
    process.env[EnvKey.WECHAT_WEB_REDIRECT_URI] =
      'https://example.com/callback';

    const config = callFactory();

    expect(config.wechatWeb).toEqual({
      appId: 'wx-web-id',
      appSecret: 'wx-web-secret',
      redirectUri: 'https://example.com/callback',
    });
  });

  it('reads wechat mobile OAuth config from env vars', () => {
    process.env[EnvKey.WECHAT_MOBILE_APP_ID] = 'wx-mobile-id';
    process.env[EnvKey.WECHAT_MOBILE_APP_SECRET] = 'wx-mobile-secret';

    const config = callFactory();

    expect(config.wechatMobile).toEqual({
      appId: 'wx-mobile-id',
      appSecret: 'wx-mobile-secret',
    });
  });

  it('reads apple OAuth appId from env vars', () => {
    process.env[EnvKey.APPLE_APP_ID] = 'com.example.app';

    const config = callFactory();

    expect(config.apple.appId).toBe('com.example.app');
  });

  it('always sets apple jwksUrl and issuer to fixed values', () => {
    const config = callFactory();

    expect(config.apple.jwksUrl).toBe('https://appleid.apple.com/auth/keys');
    expect(config.apple.issuer).toBe('https://appleid.apple.com');
  });

  it('reads QQ OAuth config from env vars', () => {
    process.env[EnvKey.QQ_APP_ID] = 'qq-id';
    process.env[EnvKey.QQ_APP_SECRET] = 'qq-secret';
    process.env[EnvKey.QQ_REDIRECT_URI] = 'https://example.com/qq/callback';

    const config = callFactory();

    expect(config.qq).toEqual({
      appId: 'qq-id',
      appSecret: 'qq-secret',
      redirectUri: 'https://example.com/qq/callback',
    });
  });
});
