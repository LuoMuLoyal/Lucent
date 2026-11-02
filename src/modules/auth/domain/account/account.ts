/**
 * 账户聚合根 —— 本地凭据身份。
 *
 * ## 聚合边界
 *
 * `Account` 拥有的是**本地凭据**那一行（`providerId = 'credential'`）：邮箱、
 * 账户状态、密码哈希。它**不**拥有 OAuth 身份集——那些是各自独立的行，
 * 按 ADR-0024「聚合之间只持 ID」，OAuth 身份在 S4 有自己的形状，通过
 * `userId` 关联而不是被嵌进来。
 *
 * 这里与计划里写的「`Account`（含 OAuth identity 集）」有意不同，理由：
 *
 * 1. 本地凭据行与每个 OAuth 链接行的**生命周期不同**——解绑一个 Google 身份
 *    不该触碰密码，改密码不该重写 OAuth 行。放进一个聚合会逼出「部分保存」。
 * 2. 「一个事务只改一个聚合」在注册路径上本来就成立：建号写的是
 *    `users` + `accounts(credential)` 两行，同属这个聚合。
 * 3. S4 的自动关联规则（受信提供商按邮箱关联）需要读 OAuth 行，但那是**读**，
 *    走 reader 而不是聚合加载。
 *
 * ## 领域纯度
 *
 * 只 import 同 `domain/` 树内的值对象。没有框架、没有 IO、没有 Result 体系——
 * 行为返回领域词汇，由应用层映射成 `DomainFailure`。
 */
import {
  isLoginAllowed,
  releasesEmail,
  toAccountStatus,
  type AccountStatus,
} from './account-status.js';
import { canonicalizeEmail, isEmailShaped } from './email.js';
import type { PasswordHash, StoredPassword } from './password-hash.js';

/** 账户聚合的完整状态。 */
export interface AccountState {
  userId: string;
  /** 规范形式前的原始邮箱；OAuth-only 账号为 `null`。 */
  email: string | null;
  status: string;
  password: StoredPassword;
}

/** 一个已加载的账户。 */
export class Account {
  private constructor(
    readonly userId: string,
    private readonly rawEmail: string | null,
    readonly status: AccountStatus,
    private readonly storedPassword: StoredPassword,
  ) {}

  /**
   * 从持久化状态重建。
   *
   * 状态字符串在这里被 {@link toAccountStatus} 收敛：未知取值变成 `suspended`
   * （失败方向是拒绝），所以聚合内部不可能出现「未识别的状态」。
   */
  static from(state: AccountState): Account {
    return new Account(
      state.userId,
      state.email,
      toAccountStatus(state.status),
      state.password,
    );
  }

  /** 规范形式的邮箱（`null` 表示没有邮箱）。 */
  get email(): string | null {
    return this.rawEmail === null ? null : canonicalizeEmail(this.rawEmail);
  }

  /** 该账户有没有可用的邮箱地址。 */
  get hasEmail(): boolean {
    return this.rawEmail !== null && isEmailShaped(this.rawEmail);
  }

  /** 该账户有没有本地密码。 */
  get hasPassword(): boolean {
    return this.storedPassword.kind === 'set';
  }

  /** 已存密码（仅在 {@link hasPassword} 为真时有值）。 */
  get passwordHash(): PasswordHash | null {
    return this.storedPassword.kind === 'set' ? this.storedPassword.hash : null;
  }

  /**
   * 该账户当前能否建立会话。
   *
   * `suspended` / `deleted` / 未知状态一律不能——判据在
   * `account-status.ts`，这里只做转发，避免「哪几种状态能登录」在两处各写一遍。
   */
  canLogin(): boolean {
    return isLoginAllowed(this.status);
  }

  /**
   * 该账户注销后，邮箱是否可以被新账号复用。
   *
   * 注册判重需要它：软删除的行还在，但邮箱应释放。
   */
  releasesEmail(): boolean {
    return releasesEmail(this.status);
  }

  /**
   * 能否为其设置新密码。
   *
   * 被停用/注销的账号不能改密码——否则一个已被封禁的用户可以通过
   * 「忘记密码」重新拿到可用凭据。**没有邮箱的账号也不能**：设密码要验证码，
   * 验证码发给邮箱。
   */
  canSetPassword(): boolean {
    return this.canLogin() && this.hasEmail;
  }
}
