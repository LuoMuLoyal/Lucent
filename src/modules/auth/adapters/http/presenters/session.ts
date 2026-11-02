import {
  calculateExpiresIn,
  formatDateTime,
  toEmailVerified,
} from '../../../../../common/index.js';
import type { UserService } from '../../../../user/index.js';
import type { SessionUser } from '../../../application/use_cases/cookie-session.js';
import type { SessionResponseDto, SessionUserDto } from '../dto/session.js';
import type { SessionCookieTokens } from '../session-cookies.js';

/**
 * 领域/应用层形状 → HTTP 响应形状。
 *
 * 表现层单独成文件，是因为它承担一件有风险的事：**决定什么可以出网**。
 * 放在这里能一眼看出「`SessionResponseDto` 里没有 tokens」，而不用翻 controller
 * 去确认某次改动没把 token 顺手塞回响应体。
 */

/**
 * 用户资料块。登录/注册/刷新共用，避免两处字段漂移。
 *
 * 账户资料的**读入口**是 `GET /account`（含 `hasPassword` / `linkedIdentities`）；
 * 这里只给「会话建立」需要的身份与展示字段，不额外查库——登录响应不该为了
 * 一个布尔位多打一次 `account` 表。
 */
export function toSessionUser(user: SessionUser): SessionUserDto {
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
 * @param accessTokenExpiresAt 只用于算 `expiresIn`——**函数签名里刻意拿不到
 *   完整的 token 对**，让「token 只能进 cookie」成为类型约束而不是纪律。
 */
export function toSessionResponse(
  user: SessionUser,
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

/**
 * 轮换后读用户：投递层唯一需要的一次补充查询。
 *
 * 轮换的返回值只带 `userId`（会话行上只有 `user_id` 列）。这里补一次用户读，
 * 让会话响应里的 `user` 块与 `GET /account` 取自同一张表，不会出现两套用户资料。
 */
export async function loadSessionUser(
  userService: UserService,
  userId: string,
): Promise<SessionUser | null> {
  return await userService.findById(userId);
}
