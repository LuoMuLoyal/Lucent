/**
 * `account` 需要的 auth 能力 —— **最小面**，由 `auth` 在本模块装配时提供。
 *
 * ## 为什么在 account 侧声明，而不是复用 auth 的 service 类
 *
 * 三个理由，每个都能独立成立：
 *
 * 1. **`arch:check` 的两条规则互斥**：走 `auth` barrel 会被
 *    `ddd-application-no-infra-or-adapters` 判违规（barrel 重新导出了
 *    `infrastructure/oauth/*`）；走 deep path 会被
 *    `modules-cross-boundary-must-use-barrel` 判违规。**任何真实 service 类都
 *    无路可走**——这不是靠加基线能解决的形状问题。
 * 2. **依赖面最小**：`account` 只用到两个能力（读「有没有密码」、验密码），
 *    却要为此背上 `PasswordReauthService` 的全部 API 与它背后的限流/审计依赖。
 * 3. **可测**：spec 注入端口替身即可，不需要构造 auth 的完整依赖树。
 *
 * ## 谁实现
 *
 * `auth` 侧已有 `AuthIdentityService.hasPassword` 与
 * `PasswordReauthService.verify`，在 `account.module.ts` 用 `useExisting`
 * 绑定即可，**不需要新写代码**。
 */
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';

/**
 * 不透明事务作用域。
 *
 * 用 `object` 而不是具名 interface：具体类型是实现的私事，调用方只需原样传回。
 * `AccountIdentity.hasPassword` 的第二个参数就是它——`unlinkIdentity` 要在
 * 同一事务里重查「有没有密码」，否则会有 TOCTOU 窗口。
 */
export type TransactionScope = object;

export abstract class AccountIdentity {
  /**
   * 该账户是否设置了密码。
   *
   * `scope` 存在时须在该事务内读（用于解绑身份时的 TOCTOU 复查）。
   */
  abstract hasPassword(
    userId: string,
    scope?: TransactionScope,
  ): ResultAsync<boolean, DomainFailure>;

  /**
   * 重验密码（敏感操作前置校验）。
   *
   * 失败语义由实现决定：密码错 → `AUTH_WRONG_PASSWORD`；没设密码 →
   * `AUTH_PASSWORD_NOT_SET`；重验次数超限 → 限流错误。**依赖故障不折进
   * 认证失败**——那会让「Redis 挂了」表现成「密码错」。
   */
  abstract verifyPassword(
    userId: string,
    password: string,
  ): ResultAsync<void, DomainFailure>;
}
