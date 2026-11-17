import { resolveHttpsHeaderPolicy } from './security-headers.js';

describe('resolveHttpsHeaderPolicy', () => {
  it('keeps the HTTPS-only headers when the public URL is https', () => {
    expect(resolveHttpsHeaderPolicy('https://lumos.example.com')).toEqual({
      cspDirectives: {},
      hsts: true,
    });
  });

  it('drops upgrade-insecure-requests and HSTS on a plain-HTTP public URL', () => {
    const policy = resolveHttpsHeaderPolicy('http://122.9.146.162:3000');

    expect(policy.cspDirectives).toEqual({
      'upgrade-insecure-requests': null,
    });
    expect(policy.hsts).toBe(false);
  });

  it('treats a missing public URL as plain HTTP', () => {
    const policy = resolveHttpsHeaderPolicy('');

    expect(policy.cspDirectives).toEqual({
      'upgrade-insecure-requests': null,
    });
    expect(policy.hsts).toBe(false);
  });

  it('ignores surrounding whitespace and scheme casing', () => {
    expect(resolveHttpsHeaderPolicy('  HTTPS://lumos.example.com  ')).toEqual({
      cspDirectives: {},
      hsts: true,
    });
  });
});
