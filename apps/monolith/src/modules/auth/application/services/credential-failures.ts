import {
  createDomainFailure,
  errAsync,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import {
  countsAsLoginFailure,
  decideCredential,
  type CredentialDecision,
  type CredentialFacts,
} from '../../domain/account/credential-verdict.js';

/**
 * 反枚举桶的**唯一定义**。
 *
 * ## 业务不变量（反枚举）
 *
 * 凭据层面的失败必须全部留在这个桶里（`kind: 'authentication'` /
 * `AUTH_WRONG_PASSWORD`），**不得**泄露账号是否存在、是否有密码、验证码是否
 * 正确。与此相对，依赖故障由调用方映射成 `DEPENDENCY_UNAVAILABLE`。
 *
 * 这条分界是安全保证而非风格偏好：**绝不把宕机折进反枚举桶，也绝不为凭据
 * 不匹配泄露这个桶以外的任何东西**。
 *
 * ## 为什么在这里而不是各个调用点
 *
 * 注册路径（邮箱已占用 / 用户查不到）与登录路径（账号不存在 / 无密码 /
 * 密码错 / 验证码错）都要落在这个桶上。两处各构造一次
 * `createDomainFailure({...})` 意味着两处可能漂移成不同的码——而「同一个桶」
 * 正是反枚举的全部内容。所以只在这里构造。
 */
export function credentialsInvalidFailure(): DomainFailure {
  return createDomainFailure({
    kind: 'authentication',
    code: 'AUTH_WRONG_PASSWORD',
  });
}

/**
 * 领域判定 → `DomainFailure` 的**唯一映射点**。
 *
 * ## 为什么映射要独立成函数
 *
 * 领域层不 import `common/result`（`ddd-domain-purity` 禁止），所以
 * 「`rejected` 对应哪个错误码」这个决定必须发生在应用层。把它收在一个函数里，
 * 反枚举就有了**一个可以审的位置**：
 *
 * - 所有 `rejected` → 同一个 `credentialsInvalidFailure()`。不是「几个分支碰巧
 *   写了同一个码」，而是**一个 switch 分支**——想拆开必须显式加 case，
 *   那是个显眼的改动。
 * - `dependency-failed` → `DEPENDENCY_UNAVAILABLE`，带 stage 作为 detail
 *   （进日志与告警，**不进**响应体）。
 *
 * ## 为什么不把 reason 写进响应
 *
 * `reason` 会暴露账号是否存在、是否有密码、验证码是否正确。它只用于限流分桶与
 * 日志。这一点在 `credential-verdict.ts` 的类型注释里也写了——两处都写是因为
 * 这里正是「不小心把它透出去」的地方。
 */
export function toCredentialFailure(
  decision: CredentialDecision,
): DomainFailure {
  switch (decision.kind) {
    case 'rejected':
      // 单一分支：所有拒绝原因在此合流，包括 ambiguous-credential。
      return credentialsInvalidFailure();
    case 'dependency-failed':
      return createDomainFailure({
        kind: 'dependency',
        code: 'DEPENDENCY_UNAVAILABLE',
        detail: `Credential dependency failed at ${decision.stage}`,
      });
    case 'accepted':
      // 调用方不该走到这里（accepted 不是失败）。返回内部错误而不是抛出，
      // 避免在失败映射函数里引入一条抛出路径。
      return createDomainFailure({
        kind: 'internal',
        code: 'INTERNAL_ERROR',
        detail: 'toCredentialFailure called with an accepted decision',
      });
  }
}

/**
 * 判定一次凭据尝试并把结论折成 Result。
 *
 * 成功时返回 `okAsync(undefined)`；失败时返回对应的 `DomainFailure`。
 * 调用方负责在失败时记账（限流）——是否计入由
 * {@link shouldCountLoginFailure} 决定，而不是调用方自己判断 kind。
 */
export function evaluateCredential(
  facts: CredentialFacts,
): ResultAsync<void, DomainFailure> {
  const decision = decideCredential(facts);
  return decision.kind === 'accepted'
    ? okAsync(undefined)
    : errAsync(toCredentialFailure(decision));
}

/**
 * 该结论是否应计入登录失败限流。
 *
 * 转发到领域函数而不是在应用层重写判据：限流分桶与反枚举桶必须同步，
 * 两处各写一遍迟早漂移。
 */
export function shouldCountLoginFailure(decision: CredentialDecision): boolean {
  return countsAsLoginFailure(decision);
}
