/**
 * OAuth 身份的**防腐层**（ACL）。
 *
 * ## 它在防什么
 *
 * 外部系统的形状会变，且它们的字段名带着自己的世界观：微信叫 `openid` /
 * `unionid` / `headimgurl`，Apple 的 token payload 用 `sub` / `email_verified`。
 * 领域层不该认识任何一个。
 *
 * 这层做**一跳**翻译：`OAuthProviderProfile`（归一化后的外部形状）→
 * `OAuthIdentity`（领域值对象）。它**不认识任何提供商的私有字段**——
 * 那部分映射在 `infrastructure/oauth/*` 里由各提供商自己完成。
 *
 * ## 为什么这一跳必须存在（而不是让提供商直接产出领域对象）
 *
 * 如果提供商直接产出 `OAuthIdentity`，那 `infrastructure/` 就依赖了
 * `domain/`——依赖方向反了（ADR-0024：`adapters → application → domain`，
 * infrastructure 实现 port）。有了 ACL，提供商只依赖
 * `application/ports/oauth-provider.ts`，翻译是**单向向内**的。
 *
 * ## 为什么放在 `adapters/acl/` 而不是 `infrastructure/oauth/`
 *
 * 若 ACL 住在 infrastructure 里，它会知道「微信返回 openid」——于是**每加一个
 * 提供商就要改 ACL**，防腐层退化成第二个提供商适配器。放在这里，ACL 的输入
 * 已经是归一化的，新增提供商不必改它。
 */
import type { OAuthIdentity } from '../../domain/account/oauth-identity.js';
import type { OAuthProviderProfile } from '../../application/ports/oauth-provider.js';

/**
 * 归一化的提供商身份 → 领域身份值对象。
 *
 * ## 只做映射，不做判断
 *
 * 这里没有「能不能自动关联」——那是 `domain/account/oauth-identity.ts` 的
 * `decideOAuthAccount`。本函数不读 `TRUSTED_IDENTITY_PROVIDERS`，也不判断
 * 邮箱是否已验证；它只把字段搬过去。
 *
 * ## 可选字段的搬运规则
 *
 * 可选字段**保持可选**（不补 `undefined` 以外的默认值）：`unionId` 缺席与
 * `unionId: undefined` 在归属判定里是同一件事，而 `email: null` 与
 * `email` 缺席也是同一件事。统一收敛成「有值才带键」让下游的判据只有一种写法。
 */
export function toOAuthIdentity(profile: OAuthProviderProfile): OAuthIdentity {
  return {
    provider: profile.provider,
    providerUserId: profile.providerUserId,
    ...(profile.unionId === undefined ? {} : { unionId: profile.unionId }),
    ...(profile.email === undefined ? {} : { email: profile.email }),
    ...(profile.emailVerifiedAt === undefined
      ? {}
      : { emailVerifiedAt: profile.emailVerifiedAt }),
    ...(profile.nickname === undefined ? {} : { nickname: profile.nickname }),
    ...(profile.avatar === undefined ? {} : { avatar: profile.avatar }),
  };
}
