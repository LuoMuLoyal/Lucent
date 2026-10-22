/**
 * Session cookie helpers for the httpOnly session flow (`/auth/session/*`).
 *
 * ## 为什么自己拼 `Set-Cookie` 而不引 `@fastify/cookie`
 *
 * 这里只需要「写两个 cookie 名字固定的 `Set-Cookie`」与「读一个 cookie」，
 * 不涉及签名、加密、解析任意 cookie 的通用需求。引入插件要给整个应用加
 * `onRequest` 钩子与 `req.cookies` 装饰器，收益不抵成本；而拼串本身是
 * **安全敏感**的（属性错误 = 降级为可被 JS 读取），所以集中在一个文件里、
 * 由测试钉住，比散落在 controller 里更可靠。
 *
 * ## 关掉的属性为什么值钱
 *
 * - `HttpOnly`：WebView / 浏览器里的脚本**读不到** token，XSS 偷不走；
 * - `Secure` + `SameSite=None`：允许跨站携带（Lumine 挂在 `devluo.com`，
 *   Lucent 在另一个 origin），`SameSite=Lax` 在跨站 XHR 上不会发送；
 * - `Path=/api/v1`：只在 API 前缀上回传，静态资源与其它路径不受牵连。
 *
 * ⚠️ `SameSite=None` **必须**配合 `Secure`，否则浏览器（Chrome 80+）直接丢弃
 * cookie。本地开发是 `http://127.0.0.1`，Secure cookie 无法下发——所以
 * 开发环境退回 `SameSite=Lax`，见 `resolveSessionCookiePolicy`。
 */

/** Access token cookie 名。httpOnly，供 `JwtAuthGuard` 的 cookie 回退读取。 */
export const SESSION_COOKIE_NAME = 'lucent_session';

/** Refresh token cookie 名。httpOnly，只被 session 端点消费。 */
export const REFRESH_COOKIE_NAME = 'lucent_refresh';

/** Cookie 生效路径：只在 API 前缀上回传。 */
export const SESSION_COOKIE_PATH = '/api/v1';

/**
 * 会话 cookie 的投放属性，由环境推导。
 *
 * @property secure 是否加 `Secure`。本地 HTTP 开发必须为 false，否则 cookie 被丢弃。
 * @property sameSite 跨站携带策略。见文件头注释：HTTP 下只能是 `Lax`。
 */
export interface SessionCookiePolicy {
  secure: boolean;
  sameSite: 'Lax' | 'None';
}

/**
 * 从 `PUBLIC_BASE_URL` 推导 cookie 属性。
 *
 * 判据是**公网地址是否 https**，而不是 `NODE_ENV`：本地跑 `NODE_ENV=production`
 * 的冒烟测试时，`Secure` cookie 在 `http://127.0.0.1` 上根本存不下来，
 * 会表现成「登录成功但刷新后掉线」这种极难排查的现象。
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
    ? { secure: true, sameSite: 'None' }
    : { secure: false, sameSite: 'Lax' };
}

/**
 * 拼一条 `Set-Cookie`。
 *
 * @param name cookie 名。
 * @param value cookie 值。**调用方负责保证已转义**（token 是 hex/JWT，不含分隔符）。
 * @param maxAgeSec 有效期（秒）。传 0 表示立即删除。
 * @param policy 由 {@link resolveSessionCookiePolicy} 得出。
 */
export function buildSessionCookie(
  name: string,
  value: string,
  maxAgeSec: number,
  policy: SessionCookiePolicy,
): string {
  const maxAge = String(Math.max(0, Math.floor(maxAgeSec)));
  const parts = [
    `${name}=${value}`,
    `Path=${SESSION_COOKIE_PATH}`,
    `Max-Age=${maxAge}`,
    'HttpOnly',
    `SameSite=${policy.sameSite}`,
  ];

  // Secure 只在 https 下加：HTTP 下的 Secure cookie 会被浏览器静默丢弃，
  // 表现是「登录接口 200 但后续请求 401」。
  if (policy.secure) parts.push('Secure');

  return parts.join('; ');
}

/**
 * 拼一条「立即失效」的 `Set-Cookie`（登出用）。
 *
 * 属性必须与投放时**完全一致**（同名、同 Path），否则浏览器认为是另一个
 * cookie，旧的删不掉——这是 cookie 语义里最容易踩的一处。
 */
export function buildExpiredSessionCookie(
  name: string,
  policy: SessionCookiePolicy,
): string {
  return buildSessionCookie(name, '', 0, policy);
}

/**
 * 从 `Cookie` 请求头里读一个 cookie 值。
 *
 * 只做最小解析：按 `;` 切分、取第一个同名项。Lucent 自己写入的 cookie 不含
 * 引号包裹或百分号编码，所以不做解码——**不做**通用 cookie 解析器是刻意的，
 * 避免为不存在的输入写兼容代码。
 *
 * @param cookieHeader 原始 `Cookie` 请求头。
 * @param name 目标 cookie 名。
 * @returns 找到的值；没有或为空串时返回 `undefined`。
 */
export function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;

    if (part.slice(0, separator).trim() !== name) continue;

    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? value : undefined;
  }

  return undefined;
}
