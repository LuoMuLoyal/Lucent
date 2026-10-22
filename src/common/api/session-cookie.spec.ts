import { describe, expect, it } from 'vitest';

import {
  buildExpiredSessionCookie,
  buildSessionCookie,
  readCookie,
  REFRESH_COOKIE_NAME,
  resolveSessionCookiePolicy,
  SESSION_COOKIE_NAME,
} from './session-cookie.js';

describe('resolveSessionCookiePolicy', () => {
  it('https 公网地址下发 Secure + SameSite=None', () => {
    expect(resolveSessionCookiePolicy('https://api.devluo.com')).toEqual({
      secure: true,
      sameSite: 'None',
    });
  });

  it('本地 http 退回 Secure=false + SameSite=Lax', () => {
    // HTTP 下带 Secure 的 cookie 会被浏览器静默丢弃，表现为「登录成功但刷新后掉线」。
    expect(resolveSessionCookiePolicy('http://127.0.0.1:3000')).toEqual({
      secure: false,
      sameSite: 'Lax',
    });
  });

  it('未配置时按非安全 HTTP 处理', () => {
    expect(resolveSessionCookiePolicy(undefined).secure).toBe(false);
    expect(resolveSessionCookiePolicy('').sameSite).toBe('Lax');
  });

  it('大小写与前导空白不影响判定', () => {
    expect(resolveSessionCookiePolicy('  HTTPS://api.devluo.com ').secure).toBe(
      true,
    );
  });
});

describe('buildSessionCookie', () => {
  const httpsPolicy = { secure: true, sameSite: 'None' as const };

  it('带上全部安全属性', () => {
    const cookie = buildSessionCookie(
      SESSION_COOKIE_NAME,
      'token-value',
      900,
      httpsPolicy,
    );

    expect(cookie).toBe(
      'lucent_session=token-value; Path=/api/v1; Max-Age=900; HttpOnly; SameSite=None; Secure',
    );
  });

  it('HttpOnly 永远在，Secure 随策略', () => {
    const cookie = buildSessionCookie(SESSION_COOKIE_NAME, 'v', 60, {
      secure: false,
      sameSite: 'Lax',
    });

    expect(cookie).toContain('HttpOnly');
    expect(cookie).not.toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('Max-Age 向下取整，负数折成 0', () => {
    expect(
      buildSessionCookie(SESSION_COOKIE_NAME, 'v', 12.9, httpsPolicy),
    ).toContain('Max-Age=12');
    expect(
      buildSessionCookie(SESSION_COOKIE_NAME, 'v', -5, httpsPolicy),
    ).toContain('Max-Age=0');
  });
});

describe('buildExpiredSessionCookie', () => {
  it('名称与 Path 与投放时一致，Max-Age=0', () => {
    const policy = { secure: true, sameSite: 'None' as const };
    const cookie = buildExpiredSessionCookie(REFRESH_COOKIE_NAME, policy);

    expect(cookie).toContain('lucent_refresh=');
    expect(cookie).toContain('Path=/api/v1');
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('HttpOnly');
  });
});

describe('readCookie', () => {
  it('从多个 cookie 中取出目标值', () => {
    expect(
      readCookie(
        'other=1; lucent_session=abc.def.ghi; lucent_refresh=xyz',
        SESSION_COOKIE_NAME,
      ),
    ).toBe('abc.def.ghi');
  });

  it('没有该 cookie 时返回 undefined', () => {
    expect(readCookie('other=1', SESSION_COOKIE_NAME)).toBeUndefined();
    expect(readCookie(undefined, SESSION_COOKIE_NAME)).toBeUndefined();
    expect(readCookie('', SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('空值视为不存在', () => {
    expect(readCookie('lucent_session=', SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('前缀相同的 cookie 不误命中', () => {
    expect(
      readCookie(
        'lucent_session_legacy=old; lucent_session=new',
        SESSION_COOKIE_NAME,
      ),
    ).toBe('new');
  });

  it('值里含 = 时只按第一个 = 切分', () => {
    expect(readCookie('lucent_session=a=b=c', SESSION_COOKIE_NAME)).toBe(
      'a=b=c',
    );
  });
});
