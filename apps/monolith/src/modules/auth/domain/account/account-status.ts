/**
 * 账户状态 —— 值对象与「能不能登录」的判定。
 *
 * ## 为什么这是一个独立的值对象
 *
 * `users.status` 有四个取值（`active` / `suspended` / `deleted` / `pending`），
 * 而「哪些能通过守卫」「哪些能登录」是两个不同的问题：
 *
 * - **守卫**只认 `active`——token 里的 `status` 不是 `active` 就 401。这是
 *   「停用即时失效」的实现方式，判据单一且必须在**不查库**的前提下成立。
 * - **登录**发生在签发 token 之前，此时可以查库；它对 `pending` 的处理与
 *   守卫不同（pending 账号补完邮箱验证后可以登录）。
 *
 * 两者都用同一个值对象，但用不同的方法——把差异写清楚，而不是让两处各自
 * 写 `status === 'active'`。
 *
 * ## 领域纯度
 *
 * 不 import 任何东西：状态是字符串联合，不是 Prisma 的 enum。这样领域层不必
 * 依赖生成物，而 infrastructure 负责把 Prisma enum 映射进来。
 */

/** 账户状态。与 `users.status` 的取值一致，但不由 Prisma 生成。 */
export type AccountStatus = 'active' | 'suspended' | 'deleted' | 'pending';

/** 已知状态集合。用 `Set` 表达「成员判定」而不是数组 `includes`。 */
const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  'active',
  'suspended',
  'deleted',
  'pending',
]);

/**
 * 把任意字符串收敛成 {@link AccountStatus}。
 *
 * 未知取值一律当 `suspended`——**失败方向是拒绝**。数据里出现意外的状态值
 * 时，把它当成「可以登录」会让一个本该被挡住的账号通过。
 */
export function toAccountStatus(value: string): AccountStatus {
  return KNOWN_STATUSES.has(value) ? (value as AccountStatus) : 'suspended';
}

/**
 * 该状态是否允许持有有效会话。
 *
 * 守卫（`JwtAccessStrategy`）用的就是这个判据：不是 `active` 的 token 一律
 * 拒绝。**判据必须只看 token 里的字段**，不能查库——否则每个请求都要多一次
 * 往返，而「停用即时失效」靠的是签发时写进 token 的 `status`。
 */
export function isSessionBearing(status: AccountStatus): boolean {
  return status === 'active';
}

/**
 * 该状态是否允许**建立**新会话（登录/注册/刷新后的签发）。
 *
 * 与 {@link isSessionBearing} 目前同值，但分开表达：将来若引入
 * 「pending 可登录但功能受限」，改这里即可，守卫不受影响。现在相同是**当前
 * 需求的巧合**，不是可以合并的理由。
 */
export function isLoginAllowed(status: AccountStatus): boolean {
  return status === 'active';
}

/**
 * 已注销账号是否可以被重新注册同一个邮箱。
 *
 * `deleted` 是软删除：行还在（保留审计与关联数据），但邮箱应可被新账号复用。
 * 这个判据影响注册的判重逻辑，所以放在领域层而不是查询条件里。
 */
export function releasesEmail(status: AccountStatus): boolean {
  return status === 'deleted';
}
