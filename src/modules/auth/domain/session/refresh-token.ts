/**
 * Refresh token 的**不可逆指纹**与重放分类 —— 纯函数。
 *
 * ## 为什么指纹是领域概念
 *
 * 会话行里存的从来不是 refresh token 本身，而是它的 SHA-256。这个约定决定了
 * 三件事，全部是安全语义而不是存储细节：
 *
 * - **查不到 = 无效**：库里没有该指纹，就等于这条 token 从未存在、已过期或
 *   已被保留任务清掉 —— 三者对外必须不可区分（否则就是枚举）。
 * - **轮换是标记而不是删除**：轮换掉的指纹仍然留在表里当作 tombstone，
 *   否则「用过的 token」与「不存在的 token」长得一样，重放检测就没有信号。
 * - **重放要分两种**：在宽限窗口内是并发竞态（只拒绝），窗口外是盗用
 *   （撤销整族）。
 *
 * ## 领域纯度
 *
 * 本文件只 import `node:crypto`（Node 标准库，不是框架、不是 IO），
 * ADR-0024 要求 `domain/` 不依赖框架与外部系统，标准库的纯计算函数在允许范围内：
 * 摘要算法是**规则本身**的一部分，藏到 infrastructure 反而让「怎么比对」离开
 * 了不变量的所在地。
 */
import { createHash } from 'node:crypto';

/**
 * 轮换后多久之内再次看到同一个 refresh token，视为并发竞态而不是盗用。
 *
 * 刻意取小：窗口越长，与合法轮换「同一瞬间」被偷走的 token 被放过的可能性越大。
 * 与 Auth0 文档里的 "reuse interval" 是同一个权衡。
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

/** refresh token（明文）→ 落库的不可逆指纹。 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 日志里保留的指纹前缀长度：够在同一用户的日志间串起来，不足以反查。 */
const DIGEST_PREFIX_LENGTH = 12;

/**
 * 日志里可以出现的指纹前缀。
 *
 * 原始 token 永远不入日志；完整指纹也不该入 —— 它是查库的键。
 */
export function refreshTokenDigestPrefix(refreshTokenHash: string): string {
  return `${refreshTokenHash.slice(0, DIGEST_PREFIX_LENGTH)}…`;
}

/** 轮换后再次出现的 refresh token 意味着什么。 */
export type RefreshReuseVerdict = 'concurrent-race' | 'reuse-detected';

/**
 * 判断一次「已经轮换过的 token 又被用了」属于哪一种。
 *
 * @param rotatedAt 该会话行被轮换掉的时间（`null` 表示尚未轮换，不会走到这里）。
 * @param at 判定时刻。
 *
 * 只有「多久之前轮换的」这一个信号可用，因此判据就是宽限窗口：
 * 窗口内当竞态，窗口外当盗用。
 */
export function classifyRefreshReuse(
  rotatedAt: Date | null,
  at: Date,
): RefreshReuseVerdict {
  if (rotatedAt === null) return 'concurrent-race';
  return at.getTime() - rotatedAt.getTime() <= REFRESH_REUSE_GRACE_MS
    ? 'concurrent-race'
    : 'reuse-detected';
}
