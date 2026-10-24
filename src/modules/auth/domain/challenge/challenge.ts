/**
 * 验证码挑战聚合。
 *
 * ## 它守的四条不变量
 *
 * 1. **单次消费**：校验成功即作废，重放读不到。
 * 2. **过期不可用**：TTL 到期即无效。
 * 3. **尝试次数上限**（本次新增）：连续猜错 {@link MAX_CHALLENGE_ATTEMPTS} 次
 *    即作废该码。这条**不是迁移保留的**——迁移前根本没有尝试计数，见下。
 * 4. **冷却与限流**不属于本聚合：冷却按 `(scene, email)` 分桶、限流按客户端，
 *    两者都不随「这一条码」的生死变化。它们是应用层策略，不是挑战的状态。
 *
 * ## 为什么「尝试次数」必须和「码」在同一个聚合里
 *
 * 它们是**同时成立**的一对：码作废与计数清零必须是一次原子操作。拆成两个存储
 * 条目就要处理「计数与码不同步过期」的一致性——例如码已过期而计数还在，或计数
 * 被清而码还活着。放在一个条目里，这个一致性问题不存在。
 *
 * ## 为什么新增尝试上限（安全变更，不是重构）
 *
 * 迁移前 `verify()` 读指纹、比对、不匹配就返回错误，**没有任何失败计数**，
 * 也没有「N 次后作废」的逻辑。风险最大的是 `forgot-password → reset-password`：
 * 猜中验证码等于**直接改密码**，而该路径没有按邮箱的尝试计数，只有全局 per-IP
 * 限流。6 位码（10^6）+ 5 分钟 TTL 下，分布式枚举是可行的。
 *
 * ## 为什么是「作废码」而不是「锁定邮箱」
 *
 * - 作废码是**聚合内**的事（改自己的状态）；锁定邮箱是**跨聚合副作用**
 *   （要影响后续发码）。聚合只管前者。
 * - 更重要的是**反噬**：锁定邮箱意味着攻击者可以用你的邮箱制造锁定，把防爆破
 *   变成 DoS 手段。作废码没有这个问题——用户重新获取一个即可。
 *
 * ## 领域纯度
 *
 * 只 import 同 `domain/` 树内的 `verification-code.js`。无框架、无 IO、
 * 不 import `common/result`——reason 是领域词汇，由应用层投影。
 */
import { codeHashesMatch, deriveCodeHash } from './verification-code.js';

/**
 * 连续猜错多少次后作废该码。
 *
 * 5 的取值理由：合法用户拿到的是邮件里的 6 位数字，输错通常来自看错或多按，
 * **连续错 5 次几乎必然意味着这不是本人**。而攻击者只有 5 次机会，
 * 10^6 / 5 在 5 分钟 TTL 内命中概率约 0.0005%，可忽略。
 */
export const MAX_CHALLENGE_ATTEMPTS = 5;

/**
 * 挑战的持久化状态 —— 存进缓存的形状。
 *
 * 刻意是**扁平可序列化**的：它进的是缓存条目，不是关系表。
 */
export interface ChallengeState {
  /** 场景。参与指纹派生，所以它必须与码一起存（否则校验时无法重算指纹）。 */
  scene: string;
  /** 邮箱。同上，参与指纹派生。 */
  email: string;
  /** 码的指纹（`sha256(scene:email:code)`）。明文码从不落存储。 */
  codeHash: string;
  /** 已失败次数。达到 {@link MAX_CHALLENGE_ATTEMPTS} 即作废。 */
  attempts: number;
  /** 写入时刻，仅用于诊断。 */
  issuedAt: Date;
}

/**
 * 一次校验尝试的结论 —— **聚合内部的 reason 词汇**。
 *
 * 注意这里**有** `expired` 与 `exhausted` 的区分，而
 * `domain/account/credential-verdict.ts` 的 `CredentialDecision` **没有**。
 * 两层各有自己的词汇，交界处做一次投影：
 *
 * | 挑战结论 | 投影到凭据判定 |
 * | --- | --- |
 * | `accepted` | `codeValid: true` |
 * | `mismatch` / `expired` / `exhausted` / `absent` | `codeValid: false` |
 *
 * 理由：聚合需要这个区分来做内部决策（例如日志里区分「码被用完了」与「码过期」），
 * 但**凭据判定的职责是「有效吗」，不是「为什么无效」**——那个词汇一旦上浮，
 * 就有被记进日志或指标标签的可能，是另一条泄露通道。
 */
export type ChallengeVerdict =
  | { kind: 'accepted' }
  | { kind: 'mismatch'; remainingAttempts: number }
  | { kind: 'exhausted' }
  | { kind: 'expired' }
  | { kind: 'absent' };

/**
 * 一个已加载的验证码挑战。
 *
 * ## 为什么方法不返回「还剩几次」
 *
 * `remainingAttempts` 只出现在 {@link verify} 的 `mismatch` 分支里，供**聚合
 * 内部与直接调用方**判断，且**不该出现在响应或日志里**：告诉攻击者「还剩 3 次」
 * 等于给他一个进度条。对合法用户它也没有价值——用户要做的是重新获取。
 */
export class VerificationChallenge {
  private constructor(private readonly state: ChallengeState) {}

  /** 从存储状态重建。 */
  static from(state: ChallengeState): VerificationChallenge {
    return new VerificationChallenge(state);
  }

  /** 当前状态快照（供持久化写回）。 */
  snapshot(): ChallengeState {
    return { ...this.state };
  }

  /** 该挑战是否已被用尽（达到尝试上限）。 */
  get isExhausted(): boolean {
    return this.state.attempts >= MAX_CHALLENGE_ATTEMPTS;
  }

  /** 已失败次数。**仅供诊断，不进响应。** */
  get attempts(): number {
    return this.state.attempts;
  }

  /**
   * 用明文码校验。
   *
   * **不修改自身**：返回结论与「写回时应存什么状态」两件事由调用方分开处理，
   * 因为「写回」是 IO（应用层的事），而聚合只做判定。这是刻意的——聚合方法
   * 保持纯粹，才能脱离存储单测。
   *
   * @returns `verdict` 是结论；`nextState` 是失败时应写回的状态
   *   （成功时为 `null`，表示该删除条目——单次消费）。
   */
  verify(code: string): {
    verdict: ChallengeVerdict;
    nextState: ChallengeState | null;
  } {
    // 用尽优先：一个被作废的码即便猜对了也不能用。放在最前是因为它必须**压倒**
    // 指纹比对——否则攻击者猜满 5 次后仍能靠第 6 次命中（如果实现成
    // 「作废但仍比对」，就白做了）。
    if (this.isExhausted) {
      return { verdict: { kind: 'exhausted' }, nextState: null };
    }

    const matches = codeHashesMatch(
      deriveCodeHash(code, this.state.scene, this.state.email),
      this.state.codeHash,
    );

    if (matches) {
      // 单次消费：成功即删除（`nextState: null`）。
      return { verdict: { kind: 'accepted' }, nextState: null };
    }

    const nextAttempts = this.state.attempts + 1;
    const exhausted = nextAttempts >= MAX_CHALLENGE_ATTEMPTS;

    return {
      verdict: exhausted
        ? { kind: 'exhausted' }
        : {
            kind: 'mismatch',
            remainingAttempts: MAX_CHALLENGE_ATTEMPTS - nextAttempts,
          },
      // 作废也写回：把 `attempts` 推到上限，让后续校验一律走 `exhausted`。
      // 保留条目而不是删除，是为了让「码被猜爆」与「码过期/不存在」在缓存层
      // 可区分（运维可观测），而两者对外的投影都是 `codeValid: false`。
      nextState: { ...this.state, attempts: nextAttempts },
    };
  }
}
