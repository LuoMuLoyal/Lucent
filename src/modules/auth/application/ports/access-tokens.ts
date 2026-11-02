/**
 * 令牌签发的出站端口 —— 领域/应用层不接触 JWT 库。
 *
 * ## 为什么签发是端口而不是应用层直接调 `JwtService`
 *
 * access token 的形状（`sub` / `email` / `status`、HS512、issuer、audience）
 * 是**部署配置与守卫之间的契约**：`JwtAccessStrategy` 用同一份配置验签，
 * 守卫靠 `status` 字段做「停用即时失效」。让应用层直接调 JWT 库，等于把
 * 这段契约摊在两个模块里各自演进。
 *
 * ## 输入是「谁 + 多久」，不是「什么 payload」
 *
 * 端口接受一个已认证主体与 TTL 秒数；payload 的拼装、`jti` 的生成、
 * 签名算法全部在 infrastructure 里。应用层因此无法顺手往 payload 塞字段——
 * 要塞必须改这里，而那是个需要 review 的位置。
 */

/** 签发 access token 所需的最小主体信息。 */
export interface AccessTokenSubject {
  userId: string;
  email: string | null;
  /** 账户状态。守卫据此拒绝非 `active` 的 token。 */
  status: string;
}

/** 一次签发的入参。 */
export interface AccessTokenRequest {
  subject: AccessTokenSubject;
  /** access token 有效期（秒）。每次签发时取当前配置，已签出的 token 不受影响。 */
  ttlSeconds: number;
}

/** 签发结果的出站端口。 */
export abstract class AccessTokens {
  /** 签一张 access token 并返回它。 */
  abstract sign(request: AccessTokenRequest): Promise<string>;
}
