/**
 * 会话 cookie 的投放策略 —— 领域层的值对象。
 *
 * ## 为什么这是领域知识而不是 HTTP 细节
 *
 * 「token 会话能不能跨站携带」「本地开发要不要降级」不是框架问题，是**安全策略**：
 *
 * - 跨站请求要带上 cookie，`SameSite` 必须是 `None`；
 * - 但浏览器规定 `SameSite=None` **必须**配 `Secure`，否则直接丢弃；
 * - 而本地开发是明文 HTTP，`Secure` cookie 存不下来。
 *
 * 三者是同一个约束链。把它放在这里（纯逻辑、无框架、可单测），
 * 而不是散在 controller 或序列化代码里，才能让「为什么本地要降级」被测试钉住
 * 而不是被注释描述。
 *
 * ## 领域纯度
 *
 * 本文件不 import 任何东西：ADR-0024 要求 `domain/` 不依赖框架与 IO。
 * 具体的 `Set-Cookie` 序列化在 `adapters/http/session_cookies.ts`。
 */

/** 会话 cookie 的名字与作用路径。 */
export const SESSION_COOKIE_NAME = 'lucent_session';

export const REFRESH_COOKIE_NAME = 'lucent_refresh';

/** 只在 API 前缀上回传，静态资源与其它路径不受牵连。 */
export const SESSION_COOKIE_PATH = '/api/v1';

/** 跨站携带策略。领域只声明语义，序列化时映射到框架的字符串。 */
export type SameSitePolicy = 'lax' | 'none';

/**
 * 会话 cookie 的投放属性。
 *
 * @property secure 是否要求 HTTPS 传输。
 * @property sameSite 跨站携带策略。
 */
export interface SessionCookiePolicy {
  secure: boolean;
  sameSite: SameSitePolicy;
}

/**
 * 从部署的公网地址推导 cookie 策略。
 *
 * 判据是**公网地址是否 https**，而不是 `NODE_ENV`：在本地用
 * `NODE_ENV=production` 跑冒烟测试时，`Secure` cookie 在 `http://127.0.0.1`
 * 上根本存不下来，表现成「登录成功但刷新后掉线」——这种故障极难从日志上看出来。
 *
 * @param publicBaseUrl 部署的公网根地址，例如 `https://api.devluo.com`。
 *   未配置（本地开发）时按非安全 HTTP 处理。
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
