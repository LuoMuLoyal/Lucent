import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';

import type { TurnstileConfig } from '../../../../config/services/turnstile.config.js';
import { TurnstileService } from './turnstile.service.js';

const enabledConfig: TurnstileConfig = {
  secretKey: 'secret-key',
  siteKey: 'site-key',
  enabled: true,
};

const disabledConfig: TurnstileConfig = {
  secretKey: '',
  siteKey: '',
  enabled: false,
};

function makeService(
  config: TurnstileConfig,
  fetchImpl: typeof fetch,
): TurnstileService {
  const configService = {
    get: vi.fn((key: string) => (key === 'turnstile' ? config : undefined)),
  } as unknown as ConfigService;
  // Construct by hand: the second parameter is an optional DI seam, and a test
  // module would only ever get the real global fetch.
  return new TurnstileService(configService, fetchImpl);
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('TurnstileService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('allows every request when the challenge is disabled', async () => {
    const fetchImpl = vi.fn();
    const service = makeService(disabledConfig, fetchImpl as never);

    const result = await service.verify(undefined);

    expect(result.isOk()).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(service.enabled).toBe(false);
  });

  it('reports AUTH_CAPTCHA_REQUIRED when enabled and no token is supplied', async () => {
    const fetchImpl = vi.fn();
    const service = makeService(enabledConfig, fetchImpl as never);

    const result = await service.verify(undefined);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('AUTH_CAPTCHA_REQUIRED');
    // No token means no reason to bother Cloudflare.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats a blank token the same as a missing one', async () => {
    const service = makeService(enabledConfig, vi.fn() as never);

    const result = await service.verify('   ');

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('AUTH_CAPTCHA_REQUIRED');
  });

  it('accepts a token Cloudflare confirms', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true }));
    const service = makeService(enabledConfig, fetchImpl as never);

    const result = await service.verify('good-token', '203.0.113.7');

    expect(result.isOk()).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    );
    expect(init.method).toBe('POST');
    expect(new URLSearchParams(init.body as string).get('response')).toBe(
      'good-token',
    );
    expect(new URLSearchParams(init.body as string).get('remoteip')).toBe(
      '203.0.113.7',
    );
  });

  it('rejects AUTH_CAPTCHA_INVALID when Cloudflare says the token is bad', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        success: false,
        'error-codes': ['invalid-input-response'],
      }),
    );
    const service = makeService(enabledConfig, fetchImpl as never);

    const result = await service.verify('bad-token');

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('AUTH_CAPTCHA_INVALID');
  });

  it('fails open when Cloudflare is unreachable', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const service = makeService(enabledConfig, fetchImpl as never);

    const result = await service.verify('some-token');

    expect(result.isOk()).toBe(true);
  });

  it('fails open when Cloudflare returns a non-2xx status', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: false }, 503));
    const service = makeService(enabledConfig, fetchImpl as never);

    const result = await service.verify('some-token');

    expect(result.isOk()).toBe(true);
  });

  it('fails open when the response body is not valid JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('Unexpected token')),
    } as unknown as Response);
    const service = makeService(enabledConfig, fetchImpl as never);

    const result = await service.verify('some-token');

    expect(result.isOk()).toBe(true);
  });

  it('exposes the public site key for clients to render the widget', () => {
    const service = makeService(enabledConfig, vi.fn() as never);

    expect(service.siteKey).toBe('site-key');
  });

  it('never sends the secret key to the client surface', () => {
    const service = makeService(enabledConfig, vi.fn() as never);

    // The public getters are the whole client-facing surface; assert the secret
    // is not reachable through them.
    expect(service.siteKey).not.toBe('secret-key');
    expect(Object.keys(service)).not.toContain('secretKey');
  });
});
