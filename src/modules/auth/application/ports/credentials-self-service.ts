/**
 * 账号自助的凭据能力端口 —— `account` 上下文需要 auth 做的**已认证**操作。
 *
 * ## 为什么只有这 3 个方法
 *
 * `PasswordManagementService` 有 7 个公开方法，这里只收 3 个：
 *
 * | 方法 | 收进端口？ | 理由 |
 * | --- | --- | --- |
 * | `changePassword` | ✅ | 已认证：改自己的密码 |
 * | `setPassword` | ✅ | 已认证：OAuth-only 账号首次设密码 |
 * | `changeEmail` | ✅ | 已认证：改自己的邮箱 |
 * | `sendVerificationCode` | ❌ | **未认证路径**：登录/注册前置，谁都能调 |
 * | `verifyEmail` | ❌ | **未认证路径**：凭邮件里的 token |
 * | `forgotPassword` | ❌ | **未认证路径**：找回密码的入口 |
 * | `resetPassword` | ❌ | **未认证路径**：凭验证码重置 |
 *
 * **判据是「已认证 vs 未认证」，不是「谁在用」**。漏掉的那 4 个属于
 * 「我还没有凭证，请给我凭证」的流程——它们的调用者不需要登录态，
 * 也就不会出现在 `account`（一个全部端点都要求 access token 的控制器）里。
 *
 * 把这个理由写下来，是为了让后人问「凭什么漏了 4 个」时有答案；
 * 也是为了如果有人想往这里加 `resetPassword`，能立刻看出方向错了
 * ——那会把一个未认证的能力暴露到一个「已认证」的端口上。
 *
 * ## 为什么是端口而不是直接导出服务类
 *
 * barrel 是**跨模块契约**。导出 `PasswordManagementService` 等于把 auth 的
 * 内部组织（它把 7 个方法放一个类里）变成别的模块可依赖的形状——那是让
 * 别人依赖你的文件布局。导出这个端口，`account` 看到的是
 * 「我能做这 3 件事」，看不到另外 4 件，也看不到实现类里还有什么。
 *
 * ## 跨上下文的同步调用
 *
 * `account`（User Profile 上下文）调用 auth（Identity & Access）是
 * **partnership 关系的同步调用**，不是分布式单体：两者在同一进程、同一数据库，
 * 「改密码必须立刻返回结果」是产品要求，不可能异步化。ADR-0024 §3 说「跨上下文
 * 写经命令/提案」，那是**服务拆出去之后**的规则；在单体阶段，同步调用是
 * 唯一合理形态。
 */
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import type { ChangeEmailDto } from '../../dto/password/change-email.dto.js';
import type { ChangePasswordDto } from '../../dto/password/change-password.dto.js';
import type { SetPasswordDto } from '../../dto/password/set-password.dto.js';

export abstract class CredentialsSelfService {
  /**
   * 改密码。要求密码重验通过，成功后**撤销该用户全部会话**。
   *
   * @param userId 已认证用户（来自 access token，不由请求体提供）。
   */
  abstract changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): ResultAsync<void, DomainFailure>;

  /**
   * 为从未设过密码的账号（OAuth-only）设置密码。
   *
   * 已有密码时返回 `RESOURCE_CONFLICT`——改密码走 {@link changePassword}。
   */
  abstract setPassword(
    userId: string,
    dto: SetPasswordDto,
  ): ResultAsync<void, DomainFailure>;

  /**
   * 改邮箱。要求密码重验 + 新邮箱的验证码。
   *
   * 返回更新后的邮箱与验证时间——调用方要用它们构造响应体，**不需要为一个
   * 布尔位再查一次账号**。只返回这两个字段（而不是整个 User）是刻意的：
   * 端口不该把 auth 的实体类型泄露给 account 上下文。
   */
  abstract changeEmail(
    userId: string,
    dto: ChangeEmailDto,
  ): ResultAsync<
    { email: string | null; emailVerifiedAt: Date | null },
    DomainFailure
  >;
}
