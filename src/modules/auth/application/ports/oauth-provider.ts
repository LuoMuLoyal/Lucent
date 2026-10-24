/**
 * OAuth 提供商的出站端口 —— 应用层不接触任何提供商的私有形状。
 *
 * ## 为什么提供商是端口
 *
 * 五个提供商各自与外部系统通信（HTTP、JWKS、token exchange、响应解码），
 * 这是**基础设施**职责。应用层只需要「拿一个凭据换一个归一化的身份」。
 *
 * ## 为什么返回的形状里没有 Prisma 类型
 *
 * 原先的 `types/oauth.types.ts` 里 `rawProfile?: Prisma.InputJsonValue`，
 * 于是 **`@prisma/client` 被引进了全部 5 个提供商文件**——而它们是纯 HTTP
 * 逻辑，根本不需要知道数据怎么落库。
 *
 * 新端口用 `Record<string, unknown>`：提供商把原始响应的**子集**放在这里，
 * 「要不要落库、落成什么形状」由 `infrastructure/persistence` 在写入时决定。
 * 原始响应因此不必一路穿过应用层与领域层。
 *
 * ## 归一化在提供商一侧完成
 *
 * 每个提供商负责把自己的私有字段名（微信的 `openid`/`unionid`、Apple 的
 * `identityToken` payload）映射成 {@link OAuthProviderProfile} 的字段。
 * 这样 ACL（`adapters/acl/oauth-profile.ts`）只需要认识**一个**形状，
 * 新增提供商不必改 ACL。
 */
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import type { OAuthProviderName } from '../../types/oauth.types.js';

/** 一个提供商归一化后的身份。字段名由本系统定义。 */
export interface OAuthProviderProfile {
  /** 提供商标识。 */
  provider: OAuthProviderName;
  /** 提供商侧的用户 id。 */
  providerUserId: string;
  /** 跨应用统一 id（微信 `unionid`）。 */
  unionId?: string;
  /** 提供商披露的邮箱；可能为 `null`。 */
  email?: string | null;
  /**
   * 提供商声明该邮箱**已验证**的时刻；`null` / 省略 = 未验证或未声明。
   *
   * 这个字段是自动关联的硬门槛（见 `domain/account/oauth-identity.ts`），
   * 所以提供商必须**如实**映射：只有提供商真的保证已验证时才给非空值。
   */
  emailVerifiedAt?: Date | null;
  nickname?: string | null;
  avatar?: string | null;
  /**
   * 原始响应的一个**子集**，供审计留档。
   *
   * 不是「整个原始响应」：提供商自己决定哪些字段有留档价值，且这里已经是
   * 可 JSON 序列化的普通对象，不带任何 ORM 类型。
   */
  rawProfile?: Record<string, unknown>;
}

/**
 * 一个 OAuth 提供商。
 *
 * 实现方（`infrastructure/oauth/*`）负责 HTTP、JWKS、解码与错误分类；
 * 端口只承诺「给我凭据，我给你归一化身份」。
 */
export interface OAuthProvider {
  /** 提供商标识。 */
  readonly provider: OAuthProviderName;

  /**
   * 构造授权跳转 URL。使用原生 UI 的提供商（Apple、微信移动端）不实现。
   */
  buildAuthorizeUrl?(state: string, callbackUri?: string): string;

  /**
   * 用前端凭据换一个归一化身份。
   *
   * 可恢复失败以 `DomainFailure` 返回：
   * - `VALIDATION_FAILED` —— 客户端凭据缺失或畸形；
   * - `DEPENDENCY_TIMEOUT` / `DEPENDENCY_UNAVAILABLE` / `DEPENDENCY_BAD_GATEWAY`
   *   —— 上游 HTTP、token exchange、JWKS 或响应解码失败。
   *
   * 配置错误（缺 appId/secret/redirectUri）与编程错误**抛出**，不折进 Result。
   */
  fetchProfile(
    credential: Record<string, unknown>,
  ): ResultAsync<OAuthProviderProfile, DomainFailure>;
}
