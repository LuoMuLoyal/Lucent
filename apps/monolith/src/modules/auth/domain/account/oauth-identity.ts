/**
 * OAuth 身份的领域值对象与**账号归属规则**。
 *
 * ## 为什么这些规则属于领域层
 *
 * `oauth.service.ts` 里那段 `matchByUnionIdOrEmail` 看起来像编排，实际是
 * **决定账号归属**的规则：什么条件下把一个外部身份挂到已有账号、什么条件下
 * 建新账号。这是 Identity & Access 上下文最敏感的一条判断——**自动关联是
 * 「别人能登进你的账号」的唯一合法路径**。
 *
 * 它以前只能靠 mock Prisma 间接覆盖，搬到这里之后每个条件都有独立的纯单测。
 *
 * ## 领域纯度
 *
 * 只 import 同 `domain/` 树内的 `identity-providers.js` 与 `email.js`。
 * 无框架、无 IO、不 import `common/result`——返回领域词汇，由应用层映射。
 */
import { canonicalizeEmail } from './email.js';
import { isTrustedIdentityProvider } from './identity-providers.js';

/**
 * 一个外部身份（某提供商侧的一条身份记录）。
 *
 * 这是**归一化后**的形状：字段名由本系统定义，不是任何提供商的私有响应。
 * 各提供商负责把自己的形状（微信的 `openid`/`unionid`、Apple 的
 * `identityToken` payload）映射进来——见 `application/ports/oauth-provider.ts`。
 */
export interface OAuthIdentity {
  /** 提供商标识（`wechat_web` / `apple` / `google` / …）。 */
  provider: string;
  /** 提供商侧的用户 id。 */
  providerUserId: string;
  /**
   * 跨应用统一 id（微信 `unionid`）。同一自然人在同厂商的不同应用里共享它，
   * 所以它能跨应用认出同一个人——这是它参与归属判定的原因。
   */
  unionId?: string;
  /** 提供商披露的邮箱。可能是 `null`（微信不总是给）。 */
  email?: string | null;
  /**
   * 该邮箱是否**已由提供商验证**。
   *
   * **这是自动关联的硬门槛**：未验证的邮箱是攻击者可以随意填写的，
   * 拿它做自动关联等于允许「注册一个提供商账号并把邮箱填成受害者地址」
   * 来接管账号。
   */
  emailVerifiedAt?: Date | null;
  nickname?: string | null;
  avatar?: string | null;
}

/**
 * 一次登录/链接尝试应当怎么落到账号上。
 *
 * - `link-existing` —— 挂到已有账号（`userId`）。
 * - `create-new` —— 建一个新账号。
 *
 * 两类都**不含**「挂到哪个账号」的查询结果——那是应用层从仓储拿到的**事实**，
 * 本函数只根据事实做决定。
 */
export type OAuthAccountDecision =
  | { kind: 'link-existing'; userId: string; reason: OAuthLinkReason }
  | { kind: 'create-new' };

/** 为什么会挂到已有账号。只用于日志与审计，**不**进响应。 */
export type OAuthLinkReason =
  /** 该 `(provider, providerUserId)` 已经有身份行——老用户再次登录。 */
  | 'identity-already-linked'
  /** 按 `unionId` 命中同一自然人的另一条身份行。 */
  | 'matched-by-union-id'
  /** 受信提供商 + 邮箱已验证 + 邮箱命中已有账号。 */
  | 'matched-by-trusted-email';

/**
 * 归属判定所需的**事实**（由应用层查好）。
 *
 * 每个字段都是「查到了什么」，不是「怎么查」。领域层因此不依赖 Prisma，
 * 也不需要事务。
 */
export interface OAuthAccountFacts {
  /** 该 `(provider, providerUserId)` 是否已有身份行；有则给出其 userId。 */
  linkedUserId: string | null;
  /** 按 `unionId` 命中的 userId（同一自然人的另一条身份行）。 */
  unionUserId: string | null;
  /**
   * 按邮箱命中的 userId。
   *
   * **`null` 表示「没有账号用这个邮箱」**。若同一邮箱对应多个账号，那是数据
   * 完整性问题——`users.email` 有唯一约束（软删除的行仍占用邮箱），所以正常
   * 情况下不可能。见 {@link decideOAuthAccount} 的注释。
   */
  emailUserId: string | null;
}

/**
 * 决定这次 OAuth 登录该挂到哪个账号。
 *
 * ## 判定顺序（每一步都有安全含义）
 *
 * 1. **已有身份行**。老用户再次登录，直接命中。放最前是因为它最精确：
 *    `(provider, providerUserId)` 是唯一键，不会认错人。
 * 2. **`unionId` 命中**。同一自然人的另一条身份行（例如先在小程序登录、
 *    后在网页登录）。仍然精确——`unionId` 由提供商保证唯一。
 * 3. **受信提供商 + 邮箱已验证 + 邮箱命中**。这是**唯一一条允许「邮箱相同即
 *    同一人」的路径**，且两个条件缺一不可：
 *    - 提供商必须在 `TRUSTED_IDENTITY_PROVIDERS` 里（Apple/Google 保证邮箱
 *      已验证）；
 *    - `emailVerifiedAt` 必须非空——即便提供商受信，没有验证时间戳就不认。
 *
 * 非受信提供商（微信、QQ）**永远走不到第 3 步**：它们的邮箱可能未经核实，
 * 拿它自动关联等于允许用「注册一个微信账号、把邮箱填成受害者地址」接管账号。
 *
 * ## 为什么不需要处理「邮箱命中多个账号」
 *
 * `users.email` 是 `@unique`（`prisma/models/user.prisma:66`），且软删除的行
 * **仍占用邮箱**（`deletedAt` 只影响查询过滤，不影响唯一约束）。所以「同一邮箱
 * 两个活跃账号」在数据库层不可能出现。应用层查到的是一个确定值，不是列表。
 *
 * 这也意味着：**已注销账号的邮箱不会被自动关联**（软删除行仍占着唯一键，
 * 而 `findByEmail` 走 `nonDeleted` 过滤后查不到）——结果是 `emailUserId: null`，
 * 走「建新账号」。这是有意的：注销过的邮箱不该让原主人的 OAuth 身份复活到
 * 一个旧账号上。
 */
export function decideOAuthAccount(
  identity: OAuthIdentity,
  facts: OAuthAccountFacts,
): OAuthAccountDecision {
  // 1. 已有身份行（最精确）。
  if (facts.linkedUserId !== null) {
    return {
      kind: 'link-existing',
      userId: facts.linkedUserId,
      reason: 'identity-already-linked',
    };
  }

  // 2. unionId 命中同一自然人的另一条身份行。
  if (identity.unionId !== undefined && facts.unionUserId !== null) {
    return {
      kind: 'link-existing',
      userId: facts.unionUserId,
      reason: 'matched-by-union-id',
    };
  }

  // 3. 受信提供商 + 邮箱已验证 → 允许按邮箱关联。
  if (canAutoLinkByEmail(identity) && facts.emailUserId !== null) {
    return {
      kind: 'link-existing',
      userId: facts.emailUserId,
      reason: 'matched-by-trusted-email',
    };
  }

  return { kind: 'create-new' };
}

/**
 * 该身份是否满足「按邮箱自动关联」的两个硬条件。
 *
 * 单独抽出来是因为它是**唯一**能让「邮箱相同」等价于「同一人」的判据，
 * 值得有一个可命名的位置——两处各写一遍 `&&` 迟早漂移。
 */
export function canAutoLinkByEmail(identity: OAuthIdentity): boolean {
  if (!isTrustedIdentityProvider(identity.provider)) return false;
  // 邮箱本身也要存在：没有邮箱就无从比对。
  if (identity.email == null || identity.email.length === 0) return false;
  // 必须**已验证**。未验证的邮箱是攻击者可随意填写的。
  return identity.emailVerifiedAt != null;
}

/**
 * 该身份是否可以**显式**链接到指定账号。
 *
 * ## 为什么受信提供商不允许显式链接
 *
 * 受信提供商走的是登录路径的**自动关联**（按已验证邮箱）。若同时允许手动链接，
 * 就出现了第二条把身份挂到账号上的路径，而它的判据不同——两条路径并存会让
 * 「这个身份属于谁」取决于用户点了哪个按钮。
 *
 * 所以：受信提供商 → 拒绝显式链接（返回 `false`，由应用层映射成
 * `RESOURCE_CONFLICT`）；其余提供商 → 允许，但要求身份未被别人占用。
 *
 * @param identity 待链接的身份。
 * @param existingOwnerUserId 该身份已属的账号（`null` = 尚未被占用）。
 * @param targetUserId 要链接到的账号。
 */
export function canExplicitlyLink(
  identity: OAuthIdentity,
  existingOwnerUserId: string | null,
  targetUserId: string,
): boolean {
  // 受信提供商走登录自动关联，不走显式链接。
  if (isTrustedIdentityProvider(identity.provider)) return false;

  // 未被占用 → 可以链接。
  if (existingOwnerUserId === null) return true;

  // 已被占用：只有本来就是自己的才幂等成功。
  return existingOwnerUserId === targetUserId;
}

/**
 * 该邮箱是否可用于按邮箱查账号。
 *
 * 抽出规范化是为了让「怎么算同一个邮箱」只有一处（`domain/account/email.ts`）。
 */
export function normalizedIdentityEmail(
  identity: OAuthIdentity,
): string | null {
  if (identity.email == null || identity.email.length === 0) return null;
  return canonicalizeEmail(identity.email);
}
