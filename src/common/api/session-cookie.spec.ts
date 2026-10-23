import { describe, expect, it } from 'vitest';

import {
  REFRESH_COOKIE_NAME,
  resolveSessionCookiePolicy,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_PATH,
  sessionCookieOptions,
} from './session-cookie.js';

describe('resolveSessionCookiePolicy', () => {
  it('https 公网地址下发 Secure + SameSite=None', () => {
    // 跨站 XHR 只有 None 才会带 cookie，而浏览器规定 None 必须配 Secure。
    expect(resolveSessionCookiePolicy('https://api.devluo.com')).toEqual({
      secure: true,
      sameSite: 'none',
    });
  });

  it('本地 http 退回 Secure=false + SameSite=Lax', () => {
    // HTTP 下带 Secure 的 cookie 会被浏览器静默丢弃，表现为「登录成功但刷新后掉线」。
    expect(resolveSessionCookiePolicy('http://127.0.0.1:3000')).toEqual({
      secure: false,
      sameSite: 'lax',
    });
  });

  it('未配置时按非安全 HTTP 处理', () => {
    expect(resolveSessionCookiePolicy(undefined).secure).toBe(false);
    expect(resolveSessionCookiePolicy('').sameSite).toBe('lax');
  });

  it('大小写与前导空白不影响判定', () => {
    expect(resolveSessionCookiePolicy('  HTTPS://api.devluo.com ').secure).toBe(
      true,
    );
  });
});

describe('sessionCookieOptions', () => {
  it('展开成 @fastify/cookie 的选项，HttpOnly 与 Path 恒定', () => {
    expect(sessionCookieOptions({ secure: true, sameSite: 'none' })).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: SESSION_COOKIE_PATH,
    });
  });

  it('非 https 时 secure 为 false，其余不变', () => {
    const options = sessionCookieOptions({ secure: false, sameSite: 'lax' });

    expect(options.secure).toBe(false);
    expect(options.httpOnly).toBe(true);
    expect(options.path).toBe('/api/v1');
  });
});

describe('cookie 名', () => {
  it('access 与 refresh 用不同的名字', () => {
    // 同名会让 refresh 覆盖 access，登录后立刻 401。
    expect(SESSION_COOKIE_NAME).not.toBe(REFRESH_COOKIE_NAME);
  });
});
