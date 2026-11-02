/**
 * 凭据判定 —— 反枚举的**纯函数实现**。
 *
 * ## 为什么这段逻辑必须是一个函数，而不是一段流程
 *
 * 反枚举的本质是「**把多种失败折叠成同一个可观察结果**」。那是一个映射，
 * 而映射是函数的形状。它以前散在 `verifyLoginCredentials` 的流程里——如果
 * 分支、`orElse`、提前返回——测试只能通过 mock 服务间接覆盖，而**没有任何
 * 一条测试能证明「账号不存在」和「密码错」走的是同一条路**。
 *
 * 搬到这里之后，折叠由**返回类型**保证：所有被拒绝的情形都是
 * `{ kind: 'rejected' }`，`reason` 只是给人看的诊断信息，调用方**不可能**
 * 只对其中某一个 reason 做特殊响应而不动其它——那需要显式地 switch 到
 * reason 上，是个显眼的改动。
 *
 * ## 两类失败在类型上就分得开（不变量 #2）
 *
 * `rejected` 与 `dependency-failed` 是**两个不同的 kind**，不是同一个
 * `failure` 的两种 reason。这是刻意的：
 *
 * - 把宕机报成「密码错」会引导用户去重置一个没有问题的密码；
 * - 如果类型上分不开，纯单测就**证明不了**这条分界——它只能证明「有个失败」。
 *
 * 类型分开之后，「依赖故障不折进反枚举桶」是一个**编译期**性质：
 * 调用方要拿到 `dependency-failed` 的 stage 必须窄化 kind，而窄化之后
 * 就再也拿不到 `rejected` 的 reason。
 *
 * ## 领域纯度
 *
 * 不 import 任何东西——连 `common/result` 都不 import（`ddd-domain-purity`
 * 禁止）。所以这里用自己的词汇（`rejected` / `dependency-failed`），由
 * `application/` 的 mapper 翻成 `DomainFailure`。这一层隔离让领域判定可以
 * 脱离整个 Result 体系单测。
 */

/** 依赖在哪一步坏掉了。用于日志与告警定位，**不**用于对外响应。 */
export type CredentialStage =
  | 'account-lookup'
  | 'password-lookup'
  | 'password-compare'
  | 'code-verify';

/**
 * 凭据被拒绝的原因。
 *
 * **只用于限流分桶，绝不出现在响应里，也不该进日志或指标。** 所有 reason 对外
 * 都是同一个 `AUTH_WRONG_PASSWORD`。理由：
 *
 * - `unknown-account` / `no-password` / `password-mismatch` 之间的区分会直接
 *   暴露账号是否存在、是否为 OAuth-only 账号；
 * - `credential-code-mismatch` 会暴露「该邮箱近期请求过验证码」；
 * - `ambiguous-credential` 覆盖「同时给了密码和验证码」「两个都没给」——
 *   它是**请求形状错误**，但对外同样不能有独立响应。
 *
 * ## 为什么「码错」与「码过期」合并成一个 reason
 *
 * 领域层的职责是回答「这个凭据有效吗」，答案只有有效或无效。**「为什么无效」
 * 在反枚举语境下必须被丢弃**；在领域层保留区分等于给下游留了一个可能被误用的
 * 口子：将来有人加日志、加指标、加审计，看到 `code-expired` 会自然地把它记进
 * 日志或指标标签——而 **reason 一旦进了日志/指标，它就以另一种渠道泄露了**
 * （攻击者拿不到 HTTP 响应，但能从运维看板的分布上推出来）。
 *
 * 所以过期与不匹配在这里合流。若某个 UseCase 确实需要向用户提示「码过期了请
 * 重新获取」，那是**该 UseCase 的 UX 决定**，应在把校验结果折成领域事实**之前**
 * 取用，而不是让这个词汇流进领域结论。
 */
export type CredentialRejectionReason =
  | 'unknown-account'
  | 'no-password'
  | 'password-mismatch'
  | 'credential-code-mismatch'
  | 'ambiguous-credential';

/**
 * 一次凭据判定的结论。
 *
 * `accepted` / `rejected` / `dependency-failed` 三态互斥。注意 `rejected` 与
 * `dependency-failed` 是**并列的 kind**，不是同一层级的 reason——见文件头注释。
 */
export type CredentialDecision =
  | { kind: 'accepted' }
  | { kind: 'rejected'; reason: CredentialRejectionReason }
  | { kind: 'dependency-failed'; stage: CredentialStage };

/** 判定输入：**事实**，不是查询。领域层不查库，它接收已经查好的事实。 */
export interface CredentialFacts {
  /** 该邮箱对应的账号是否存在（`null` = 不存在）。 */
  accountFound: boolean;
  /**
   * 账号上存的密码。`none` = 没有本地密码（OAuth-only 账号，或从未设过）。
   * 账号不存在时该字段无意义，调用方传 `none`。
   */
  storedPassword: 'set' | 'none';
  /** 请求里给了哪些凭据。两者都给或都不给 → `ambiguous-credential`。 */
  presented: 'password' | 'code' | 'both' | 'neither';
  /**
   * 密码比对结果（仅在 `presented === 'password'` 且账号有密码时有意义）。
   * `null` = 未执行比对。
   */
  passwordMatches: boolean | null;
  /**
   * 验证码校验结果（仅在 `presented === 'code'` 时有意义）。
   * `null` = 未执行校验。
   *
   * **只有「有效 / 无效」两态，不区分「码错」与「码过期」**：领域层不需要那个
   * 区分（见 `CredentialRejectionReason` 的注释），而把校验器的三态直接透传上来
   * 会让「为什么无效」这个词汇有机会流进领域结论、进而流进日志。
   * 需要区分的地方（如果真有）在调用方折成事实**之前**取用。
   */
  codeValid: boolean | null;
  /**
   * 依赖故障。非 `null` 时**短路一切**：判定直接返回
   * `dependency-failed`，绝不会落到 `rejected`。
   *
   * 这是不变量 #2 在类型层的落点——依赖故障与凭据失败是**两个不同的输入**，
   * 因此不可能被折叠成同一个输出。
   */
  dependencyFailure: CredentialStage | null;
}

/**
 * 判定一次登录尝试。
 *
 * ## 求值顺序（每一步都有安全含义）
 *
 * 1. **依赖故障优先**。任何一步坏了都直接返回 `dependency-failed`。
 *    放在最前是因为它必须**压倒**凭据结论：如果查账号时库就断了，
 *    我们不能说「账号不存在」——那是把宕机说成账号问题。
 * 2. **请求形状**。密码与验证码都给/都不给 → `ambiguous-credential`。
 *    这仍然是「拒绝」，不是「验证失败」，但对外不可区分。
 * 3. **账号存在性** → `unknown-account`。
 * 4. **凭据比对**。密码路径要求账号有密码（否则 `no-password`）；
 *    验证码路径按校验结果映射 mismatch/expired。
 *
 * ## 为什么不做「账号不存在时也跑一次哈希比对」
 *
 * 那是常见的**时序**反枚举手段（让不存在的账号也消耗一次 Argon2，避免通过
 * 响应时间区分）。这里**有意不做**，理由：本系统的限流器按邮箱分桶并对所有
 * 失败计数（见 `AuthRateLimitService`），时序侧信道在限流生效后价值有限；
 * 而给每个不存在的邮箱白跑一次 Argon2（19 MiB / 次）等于把登录接口变成
 * 内存放大攻击的入口。**这是一个有意识的取舍，不是遗漏**——若将来要补，
 * 应该在限流之前加，并配一个独立的内存预算。
 */
export function decideCredential(facts: CredentialFacts): CredentialDecision {
  // 1. 依赖故障压倒一切（不变量 #2）。
  if (facts.dependencyFailure !== null) {
    return { kind: 'dependency-failed', stage: facts.dependencyFailure };
  }

  // 2. 请求形状：两者都给、或两者都不给。
  if (facts.presented === 'both' || facts.presented === 'neither') {
    return { kind: 'rejected', reason: 'ambiguous-credential' };
  }

  // 3. 账号不存在。
  if (!facts.accountFound) {
    return { kind: 'rejected', reason: 'unknown-account' };
  }

  // 4a. 验证码路径。
  if (facts.presented === 'code') {
    if (facts.codeValid === true) {
      return { kind: 'accepted' };
    }
    // 不匹配、过期、未执行（`null`）在这里**合流**：领域层不保留「为什么无效」
    // 的区分，理由见 CredentialRejectionReason 的注释（侧信道）。
    return { kind: 'rejected', reason: 'credential-code-mismatch' };
  }

  // 4b. 密码路径。
  if (facts.storedPassword === 'none') {
    return { kind: 'rejected', reason: 'no-password' };
  }
  if (facts.passwordMatches === true) {
    return { kind: 'accepted' };
  }
  return { kind: 'rejected', reason: 'password-mismatch' };
}

/**
 * 该结论是否应当计入登录失败限流。
 *
 * **所有 `rejected` 都计入**，包括 `ambiguous-credential`——否则攻击者可以用
 * 畸形请求（同时给密码和验证码）来无限探测而不触发锁号。
 *
 * `dependency-failed` **不计入**：那不是用户的错，把它计入会让一次缓存抖动
 * 把一批用户锁在门外。
 */
export function countsAsLoginFailure(decision: CredentialDecision): boolean {
  return decision.kind === 'rejected';
}
