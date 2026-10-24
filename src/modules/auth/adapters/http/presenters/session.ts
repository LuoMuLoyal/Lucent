import type { User } from '#generated/prisma/client.js';
import {
  calculateExpiresIn,
  formatDateTime,
  toEmailVerified,
} from '../../../../../common/index.js';
import type { SessionResponseDto, SessionUserDto } from '../dto/session.js';
import type { SessionCookieTokens } from '../session_cookies.js';

/**
 * 领域/持久化形状 → HTTP 响应形状。
 *
 * 表现层单独成文件，是因为它承担一件有风险的事：**决定什么可以出网**。
 * 放在这里能一眼看出「`SessionResponseDto` 里没有 tokens」，而不用翻 controller
 * 去确认某次改动没把 token 顺手塞回响应体。
 */

/** 会话响应用到的用户字段子集。 */
type UserSource = Pick<
  User,
  | 'id'
  | 'email'
  | 'nickname'
  | 'avatar'
  | 'emailVerifiedAt'
  | 'createdAt'
  | 'updatedAt'
>;

/**
 * 用户资料块。登录/注册/刷新共用，避免两处字段漂移。
 *
 * 账户资料的**读入口**是 `GET /account`（含 `hasPassword` / `linkedIdentities`）；
 * 这里只给「会话建立」需要的身份与展示字段，不额外查库——登录响应不该为了
 * 一个布尔位多打一次 `account` 表。
 */
export function toSessionUser(user: UserSource): SessionUserDto {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    avatar: user.avatar,
    emailVerified: toEmailVerified(user.emailVerifiedAt),
    emailVerifiedAt: formatDateTime(user.emailVerifiedAt),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

/**
 * 构造会话响应。
 *
 * @param user 用户实体。
 * @param tokens 只用于算 `expiresIn` 与 cookie 的 `Max-Age`——
 *   **函数签名里刻意拿不到完整的 token 对**，让「token 只能进 cookie」成为
 *   类型约束而不是纪律。
 */
export function toSessionResponse(
  user: UserSource,
  accessTokenExpiresAt: string,
): SessionResponseDto {
  return {
    user: toSessionUser(user),
    expiresIn: calculateExpiresIn(accessTokenExpiresAt),
  };
}

/** 把 token 对换算成 cookie 需要的 `Max-Age`（秒）。 */
export function toCookieTokens(pair: {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}): SessionCookieTokens {
  return {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    accessMaxAge: calculateExpiresIn(pair.accessTokenExpiresAt),
    refreshMaxAge: calculateExpiresIn(pair.refreshTokenExpiresAt),
  };
}
