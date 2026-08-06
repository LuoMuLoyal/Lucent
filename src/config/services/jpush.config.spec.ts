import { ConfigKey } from '../env/config-keys.enum';
import { EnvKey } from '../env/env-keys.enum';
import { DEFAULT_JPUSH_API_BASE_URL, jpushConfig } from './jpush.config';

describe('jpushConfig', () => {
  const keys = [
    EnvKey.JPUSH_APP_KEY,
    EnvKey.JPUSH_MASTER_SECRET,
    EnvKey.JPUSH_APNS_PRODUCTION,
    EnvKey.JPUSH_API_BASE_URL,
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) {
      saved[key] = process.env[key];
      Reflect.deleteProperty(process.env, key);
    }
  });

  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('is registered under ConfigKey.Jpush', () => {
    expect(jpushConfig.KEY).toContain(ConfigKey.Jpush);
  });

  it('defaults to disabled credentials and the JPush API endpoint', () => {
    expect(jpushConfig()).toEqual({
      appKey: '',
      masterSecret: '',
      apnsProduction: false,
      apiBaseUrl: DEFAULT_JPUSH_API_BASE_URL,
    });
  });

  it('reads and normalizes configured values', () => {
    process.env[EnvKey.JPUSH_APP_KEY] = ' appkey-1 ';
    process.env[EnvKey.JPUSH_MASTER_SECRET] = ' secret-1 ';
    process.env[EnvKey.JPUSH_APNS_PRODUCTION] = 'true';
    process.env[EnvKey.JPUSH_API_BASE_URL] = ' https://api.jpush.cn/ ';

    expect(jpushConfig()).toEqual({
      appKey: 'appkey-1',
      masterSecret: 'secret-1',
      apnsProduction: true,
      apiBaseUrl: 'https://api.jpush.cn/',
    });
  });
});
