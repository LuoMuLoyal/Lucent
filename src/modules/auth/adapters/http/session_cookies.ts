import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply } from 'fastify';

import {
  REFRESH_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_PATH,
  type SessionCookiePolicy,
} from '../../domain/session/cookie_policy.js';

/**
 * `Set-Cookie` 的**序列化** —— HTTP 投递层。
 *
 * 属性该是什么由领域决定（`domain/session/cookie_policy.ts`）；
 * 怎么拼成合法响应头由 `@fastify/cookie` 决定。本文件只做两者之间的映射，
 * 因此不承载任何业务判断。
 *
 * ## 为什么投放与清理共用 {@link toCookieOptions}
 *
 * `clearCookie` 靠**同名同 path/domain** 才能删掉浏览器上那一条。
 * 一旦两处各自写属性，就会出现「服务端以为清了、浏览器还在带旧 cookie」，
 * 而症状是后续请求一直 401 —— 把选项收敛成一个函数，这条路就没有分叉。
 */

/** 领域策略 → `@fastify/cookie` 选项。 */
export function toCookieOptions(
  policy: SessionCookiePolicy,
): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: policy.secure,
    sameSite: policy.sameSite,
    path: SESSION_COOKIE_PATH,
  };
}

/** 会话 token 对在 HTTP 层的形状：只需要值与有效期。 */
export interface SessionCookieTokens {
  accessToken: string;
  refreshToken: string;
  /** access token 剩余秒数，直接作为 `Max-Age`。 */
  accessMaxAge: number;
  /** refresh token 剩余秒数，直接作为 `Max-Age`。 */
  refreshMaxAge: number;
}

/**
 * 投放两个会话 cookie。
 *
 * access 短、refresh 长；两者的 `Max-Age` 分别由各自的到期时间算出，
 * 让浏览器在 token 失效的同一时刻丢弃它，而不是留一个必然 401 的陈旧值。
 */
export function writeSessionCookies(
  reply: FastifyReply,
  tokens: SessionCookieTokens,
  policy: SessionCookiePolicy,
): void {
  const options = toCookieOptions(policy);

  reply.setCookie(SESSION_COOKIE_NAME, tokens.accessToken, {
    ...options,
    maxAge: tokens.accessMaxAge,
  });
  reply.setCookie(REFRESH_COOKIE_NAME, tokens.refreshToken, {
    ...options,
    maxAge: tokens.refreshMaxAge,
  });
}

/** 清掉两个会话 cookie。选项与 {@link writeSessionCookies} 完全同源。 */
export function clearSessionCookies(
  reply: FastifyReply,
  policy: SessionCookiePolicy,
): void {
  const options = toCookieOptions(policy);

  reply.clearCookie(SESSION_COOKIE_NAME, options);
  reply.clearCookie(REFRESH_COOKIE_NAME, options);
}
