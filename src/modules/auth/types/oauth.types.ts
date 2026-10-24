export const OAUTH_PROVIDER_WECHAT_WEB = 'wechat_web';
export const OAUTH_PROVIDER_WECHAT_MOBILE = 'wechat_mobile';
export const OAUTH_PROVIDER_APPLE = 'apple';
export const OAUTH_PROVIDER_QQ = 'qq';
export const OAUTH_PROVIDER_GOOGLE = 'google';

export type OAuthProviderName =
  | typeof OAUTH_PROVIDER_WECHAT_WEB
  | typeof OAUTH_PROVIDER_WECHAT_MOBILE
  | typeof OAUTH_PROVIDER_APPLE
  | typeof OAUTH_PROVIDER_QQ
  | typeof OAUTH_PROVIDER_GOOGLE;

export interface OAuthAuthorizeResult {
  authorizeUrl: string;
  state: string;
  expiresIn: number;
  callbackUri?: string;
}

/**
 * 一个提供商归一化后的身份（应用层形状）。
 *
 * ## 这里**没有** Prisma 类型
 *
 * 原先 `rawProfile?: Prisma.InputJsonValue` 让 `@prisma/client` 被引进全部 5 个
 * 提供商文件——而它们是纯 HTTP 逻辑，根本不需要知道数据怎么落库。
 * 现在用 `Record<string, unknown>`：「要不要落库、落成什么形状」由
 * `infrastructure/persistence` 在写入时决定。
 *
 * ## 与 `application/ports/oauth-provider.ts` 的关系
 *
 * 那里定义端口契约（`OAuthProviderProfile`）；本类型是它的应用层对应物。
 * 领域层不认识这个类型——它只认识 `domain/account/oauth-identity.ts` 的
 * `OAuthIdentity`，由 `adapters/acl/oauth-profile.ts` 翻译过去。
 */
export interface OAuthProfile {
  provider: OAuthProviderName;
  providerUserId: string;
  unionId?: string;
  email?: string | null;
  emailVerifiedAt?: Date | null;
  nickname?: string | null;
  avatar?: string | null;
  rawProfile?: Record<string, unknown>;
}
