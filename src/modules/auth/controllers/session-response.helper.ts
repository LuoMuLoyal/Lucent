import type { User } from '#generated/prisma/client.js';
import {
  calculateExpiresIn,
  formatDateTime,
  toEmailVerified,
} from '../../../common/index.js';
import type {
  SessionResponseDto,
  SessionUserDto,
} from '../dto/shared/session.dto.js';
import type { TokenPair } from '../types/auth-request.js';

/**
 * 把 token 对 + 用户转成 **cookie 会话**的响应体。
 *
 * 与 `buildAuthResponse` 的差异只有一处，但很关键：**响应里没有 `tokens`**。
 * token 只进 `Set-Cookie`，脚本读不到；前端拿到的只有用户资料与
 * 「access token 还剩多少秒」（用于安排静默刷新）。
 *
 * 单独成文件而不是给 `buildAuthResponse` 加个开关：两条路的产物形态不同，
 * 用一个布尔参数切换返回值类型会让调用端失去类型约束。
 */

/** 会话响应用到的用户字段子集。 */
type SessionUserSource = Pick<
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
 * 用户资料块。`/auth/me` 与登录/注册/刷新共用它，避免两处字段漂移。
 */
export function toSessionUser(user: SessionUserSource): SessionUserDto {
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
 * @param user 用户实体。
 * @param tokens token 对。**只在这里读 expiry**——调用方随后应只把两个 token
 *   写进 cookie，不再透传给响应体。
 */
export function buildSessionResponse(
  user: SessionUserSource,
  tokens: TokenPair,
): SessionResponseDto {
  return {
    user: toSessionUser(user),
    expiresIn: calculateExpiresIn(tokens.accessTokenExpiresAt),
  };
}
