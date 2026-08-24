import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { JpushConfig } from '../../../config/services/jpush.config';
import { JpushPushProvider } from './jpush.provider';

function buildConfig(overrides: Partial<JpushConfig> = {}): JpushConfig {
  return {
    appKey: 'appkey-1',
    masterSecret: 'secret-1',
    apnsProduction: false,
    apiBaseUrl: 'https://api.jpush.cn',
    ...overrides,
  };
}

describe('JpushPushProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(JSON.stringify({ sendno: '1001', msg_id: 'm1' })),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is not configured when either credential is empty', () => {
    expect(
      new JpushPushProvider(buildConfig({ appKey: '' })).isConfigured,
    ).toBe(false);
    expect(
      new JpushPushProvider(buildConfig({ masterSecret: '' })).isConfigured,
    ).toBe(false);
  });

  it('warns once at construction when unconfigured in production', () => {
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const previousNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      new JpushPushProvider(buildConfig({ appKey: '' }), 'production');

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain(
        'JPush is not configured — push delivery is silently disabled.',
      );
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env['NODE_ENV'];
      } else {
        process.env['NODE_ENV'] = previousNodeEnv;
      }
      warnSpy.mockRestore();
    }
  });

  it('does not call fetch when not configured or aliases are empty', async () => {
    await new JpushPushProvider(buildConfig({ appKey: '' })).send(['u-1'], {
      title: 't',
      body: 'b',
    });
    await new JpushPushProvider(buildConfig()).send([], {
      title: 't',
      body: 'b',
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts an authenticated Android/iOS alias payload', async () => {
    await new JpushPushProvider(buildConfig()).send(['u-1', 'u-2'], {
      title: '标题',
      body: '正文',
      data: { action: 'medicine_reminder' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, rawInit] = fetchMock.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://api.jpush.cn/v3/push');
    expect(rawInit.method).toBe('POST');
    expect(rawInit.headers['Authorization']).toBe(
      `Basic ${Buffer.from('appkey-1:secret-1').toString('base64')}`,
    );
    expect(rawInit.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(rawInit.body) as {
      platform: string[];
      audience: { alias: string[] };
      notification: {
        alert: string;
        android: { title: string; extras: Record<string, unknown> };
        ios: {
          alert: { title: string; body: string };
          extras: Record<string, unknown>;
        };
      };
      options: { apns_production: boolean; time_to_live: number };
    };
    expect(body.platform).toEqual(['android', 'ios']);
    expect(body.audience).toEqual({ alias: ['u-1', 'u-2'] });
    expect(body.notification.alert).toBe('正文');
    expect(body.notification.android.title).toBe('标题');
    expect(body.notification.android.extras).toEqual({
      action: 'medicine_reminder',
    });
    expect(body.notification.ios.alert).toEqual({
      title: '标题',
      body: '正文',
    });
    expect(body.notification.ios.extras).toEqual({
      action: 'medicine_reminder',
    });
    expect(body.options.apns_production).toBe(false);
    expect(body.options.time_to_live).toBe(86400);
  });

  it('batches aliases by 1000', async () => {
    const aliases = Array.from({ length: 2500 }, (_, index) => `u-${index}`);

    await new JpushPushProvider(buildConfig()).send(aliases, {
      title: 't',
      body: 'b',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const batchSizes = fetchMock.mock.calls.map(([, rawInit]) => {
      const init = rawInit as { body: string };
      const body = JSON.parse(init.body) as { audience: { alias: string[] } };
      return body.audience.alias.length;
    });
    expect(batchSizes).toEqual([1000, 1000, 500]);
  });

  it('throws ServiceUnavailableException on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: () =>
        Promise.resolve(JSON.stringify({ error: { message: 'bad auth' } })),
    });

    await expect(
      new JpushPushProvider(buildConfig()).send(['u-1'], {
        title: 't',
        body: 'b',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
