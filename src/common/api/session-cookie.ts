import type { CookieSerializeOptions } from '@fastify/cookie';

/**
 * 会话 cookie 的名字、路径与属性策略（`/auth/session/*`）。
 *
 * ## 序列化交给 `@fastify/cookie`
 *
 * 实际写 cookie 用 `reply.setCookie` / `reply.clearCookie`（插件在
 * `setup-app.ts` 注册）。这里只决定**投什么属性**——那是业务判断，
 * 不该散落在 controller 里；而拼 `Set-Cookie` 字符串、转义值、
 * 保证「清除时属性与投放时一致」这些机械活儿交给插件。
 *
 * ## 属性为什么是这几个
 *
 * - `httpOnly`：WebView / 浏览器里的脚本**读不到** token，XSS 偷不走；
 * - `path: '/api/v1'`：只在 API 前缀上回传，静态资源与其它路径不受牵连；
 * - `sameSite: 'None'` + `secure`：Lumine 的 Web 与桌面宿主都在别的 origin
 *   （`devluo.com` / `localhost:1420` / `tauri://localhost`），`Lax` 在跨站
 *   XHR 上根本不会发送。⚠️ 浏览器规定 `SameSite=None` **必须**配 `Secure`，
 *   所以本地 HTTP 开发只能退回 `Lax` —— 见 {@link resolveSessionCookiePolicy}。
 */

/** Access token cookie 名。httpOnly，供 `JwtAuthStrategy` 的 cookie 回退读取。 */
export const SESSION_COOKIE_NAME = 'lucent_session';

/** Refresh token cookie 名。httpOnly，只被 session 端点消费。 */
export const REFRESH_COOKIE_NAME = 'lucent_refresh';

/** Cookie 生效路径：只在 API 前缀上回传。 */
export const SESSION_COOKIE_PATH = '/api/v1';

/**
 * 会话 cookie 的投放属性，由部署形态推导。
 *
 * @property secure 是否加 `Secure`。本地 HTTP 开发必须为 false，否则 cookie 被丢弃。
 * @property sameSite 跨站携带策略。见文件头注释：HTTP 下只能是 `Lax`。
 */
export interface SessionCookiePolicy {
  secure: boolean;
  sameSite: 'lax' | 'none';
}

/**
 * 从 `PUBLIC_BASE_URL` 推导 cookie 属性。
 *
 * 判据是**公网地址是否 https**，而不是 `NODE_ENV`：本地跑 `NODE_ENV=production`
 * 的冒烟测试时，`Secure` cookie 在 `http://127.0.0.1` 上根本存不下来，
 * 表现成「登录成功但刷新后掉线」这种极难排查的现象。
 *
 * 未配置 `PUBLIC_BASE_URL`（本地开发）时按「非安全 HTTP」处理。
 *
 * @param publicBaseUrl 部署的公网根地址，例如 `https://api.devluo.com`。
 */
export function resolveSessionCookiePolicy(
  publicBaseUrl: string | undefined,
): SessionCookiePolicy {
  const isHttps = (publicBaseUrl ?? '')
    .trim()
    .toLowerCase()
    .startsWith('https://');
  return isHttps
    ? { secure: true, sameSite: 'none' }
    : { secure: false, sameSite: 'lax' };
}

/**
 * 把策略展开成 `reply.setCookie` 的选项。
 *
 * `clearCookie` 用同一份选项即可——插件会据 `path` / `domain` 生成匹配的
 * 过期指令，不会出现「属性对不上导致旧 cookie 删不掉」。
 *
 * @param policy 由 {@link resolveSessionCookiePolicy} 得出。
 */
export function sessionCookieOptions(
  policy: SessionCookiePolicy,
): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: policy.secure,
    sameSite: policy.sameSite,
    path: SESSION_COOKIE_PATH,
  };
}
