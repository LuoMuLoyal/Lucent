/**
 * 身份提供商标识与「受信提供商」策略。
 *
 * ## 身份层的两条分流
 *
 * 本地凭据身份是**单行** `providerId = 'credential'`（`issuer` 为
 * `local:credential`，`accountId` 即 userId，一个用户至多一条）；每个 OAuth
 * 链接各是一条独立身份行（`issuer = providerId = 提供商标识`，
 * `accountId = 提供商侧用户 id`）。这两个常量是那条分流的判据，所以属于领域层。
 *
 * ## 受信提供商是**账号关联策略**，不是 OAuth 细节
 *
 * `TRUSTED_IDENTITY_PROVIDERS` 回答的是「哪些提供商的登录可以按邮箱自动关联到
 * 已有账号」。这是账户聚合的规则（影响 `Account` 的归属），不是 HTTP 或 SDK
 * 的事——所以放在 `domain/account/` 而不是 `infrastructure/oauth/`。
 *
 * 同时它是**唯一来源**：OAuth 的显式链接要拒绝这些提供商（它们走登录自动关联），
 * 那条拒绝也引用这里。两处各写一份名单，迟早出现「能自动关联但也能手动链接」
 * 这种互相矛盾的组合。
 *
 * ## 领域纯度
 *
 * 不 import 任何东西。
 */

/** `providerId` of the local email+password identity. */
export const CREDENTIAL_PROVIDER_ID = 'credential';

/** `issuer` recorded on local email+password identities. */
export const LOCAL_CREDENTIAL_ISSUER = 'local:credential';

/**
 * 允许按邮箱自动关联到已有账号的提供商。
 *
 * 名单短是刻意的：只有能**可靠提供已验证邮箱**的提供商才该进来。把它放宽到
 * 邮箱未验证的提供商，等于允许攻击者用「注册一个该提供商账号并把邮箱填成
 * 受害者地址」来接管账号。
 */
export const TRUSTED_IDENTITY_PROVIDERS = ['apple', 'google'] as const;

/**
 * Type guard：`provider` 是否属于受信提供商。
 *
 * 封装 `readonly` → `string[]` 的断言，调用点因此不需要各自的类型转换。
 */
export function isTrustedIdentityProvider(provider: string): boolean {
  return (TRUSTED_IDENTITY_PROVIDERS as readonly string[]).includes(provider);
}
