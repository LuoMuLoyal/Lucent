/**
 * 会话聚合。
 *
 * ## 一个会话行承载两件事
 *
 * 它既是**refresh token 的存储位置**（指纹、过期、轮换标记、族根），也是
 * **设备清单的一行**（设备类型、最近使用、创建时间）。两者共用一个行是因为
 * 生命周期完全重合：会话建立即签发 refresh token，会话吊销即 token 作废。
 *
 * ## 为什么 refresh 轮换的判定在领域层
 *
 * 「这条 refresh token 还能不能换」不是流程问题，是三条不变量：
 *
 * 1. **过期/已吊销** → 不可用，且与「不存在」对外不可区分。
 * 2. **已轮换** → 不可再用。轮换是**一次性**的：同一个 token 只能换一次。
 * 3. **已轮换且已过宽限窗口** → 视为盗用，整族作废（RFC 9700 §4.13.2）。
 *
 * 这三条以前散在 `AuthTokenService.rotateSession` 的流程里，只能靠 mock 仓储
 * 间接验证；搬到这里之后是纯函数单测。
 *
 * ## 领域纯度
 *
 * 不 import 任何东西（连 `node:crypto` 都不需要——指纹算法在
 * `refresh-token.ts`）。返回的是领域词汇（见 {@link RefreshDecision}），
 * 具体错误码由应用层映射。
 */
import {
  classifyRefreshReuse,
  refreshTokenDigestPrefix,
  type RefreshReuseVerdict,
} from './refresh-token.js';

/** 会话行（写侧聚合状态）。 */
export interface SessionState {
  /** 会话 id。全新会话里它同时是族根（见 {@link SESSION_FAMILY_ROOT}）。 */
  id: string;
  userId: string;
  /** refresh token 的 SHA-256 指纹。明文从不落库。 */
  refreshTokenHash: string;
  /**
   * 族根。一次登录开一族（族根 = 该会话自己的 id），后续每次轮换产生的
   * 新会话都加入同一族——撤销族根即撤销整条链。
   */
  familyId: string;
  /** refresh token 的有效期。 */
  expiresAt: Date;
  /** 吊销时刻；`null` 表示仍有效。 */
  revokedAt: Date | null;
  /** 该行的 refresh token 被换走（轮换掉）的时刻；`null` 表示尚未轮换。 */
  rotatedAt: Date | null;
}

/**
 * 「当前行该用哪个 id 做族根」。
 *
 * 语义常量，不是取值：调用方**不传** `familyId` 时用它表示「这是一次全新登录，
 * 以新会话 id 为族根」。用常量而不是 `undefined`，是为了让仓储端口上的
 * `familyId: string` 保持非空——族根永远不会缺席。
 */
export const SESSION_FAMILY_ROOT = 'self' as const;

export type SessionFamilyRoot = typeof SESSION_FAMILY_ROOT;

/**
 * 一次 refresh 尝试的领域判定。
 *
 * - `invalid` —— 不存在 / 过期 / 已吊销：对外一律不可区分。
 * - `concurrent-race` —— 已轮换但还在宽限窗口内：并发请求的落败方，只拒绝。
 * - `reuse-detected` —— 已轮换且过了宽限窗口：盗用，必须撤销整族。
 * - `rotate` —— 可轮换，带出族根与 userId 让应用层签发新的一对。
 */
export type RefreshDecision =
  | { kind: 'invalid'; reason: 'expired' | 'revoked' }
  | {
      kind: 'concurrent-race';
      userId: string;
      familyId: string;
      rotatedAgoMs: number;
    }
  | {
      kind: 'reuse-detected';
      userId: string;
      familyId: string;
      rotatedAgoMs: number;
    }
  | { kind: 'rotate'; userId: string; familyId: string };

/** 一次 refresh 尝试可选的观测上下文（日志用）。 */
export interface RefreshAttempt {
  /** 解析 refresh token 的指纹。 */
  refreshTokenHash: string;
  /** 判定时刻。 */
  at: Date;
}

/**
 * 决定一条会话行能否用于 refresh。
 *
 * **顺序是有含义的**：先判过期/吊销（那是「这条 token 已经被判死」），
 * 再判轮换（那是「token 用过了」）。顺序颠倒会把「吊销后又轮换」误判成
 * 盗用，从而在一个已经死掉的族上再撤销一次（无害，但会污染告警）。
 */
export function decideRefresh(state: SessionState, at: Date): RefreshDecision {
  if (state.revokedAt !== null) {
    return { kind: 'invalid', reason: 'revoked' };
  }
  if (state.expiresAt.getTime() <= at.getTime()) {
    return { kind: 'invalid', reason: 'expired' };
  }

  if (state.rotatedAt !== null) {
    const verdict: RefreshReuseVerdict = classifyRefreshReuse(
      state.rotatedAt,
      at,
    );
    return {
      kind: verdict,
      userId: state.userId,
      familyId: state.familyId,
      rotatedAgoMs: at.getTime() - state.rotatedAt.getTime(),
    };
  }

  return { kind: 'rotate', userId: state.userId, familyId: state.familyId };
}

/** 一次 refresh 尝试的日志行（指纹只留前缀）。 */
export interface RefreshLogEntry {
  reason:
    | 'not-found'
    | 'expired'
    | 'revoked'
    | 'concurrent-refresh'
    | 'reuse-detected'
    | 'vanished-during-claim';
  refreshTokenHashPrefix: string;
  userId?: string;
  familyId?: string;
  rotatedAgoMs?: number;
  revokedSessions?: number;
}

/**
 * 把判定翻译成日志行；`rotate` 不需要日志（成功路径不打点）。
 *
 * 放在领域层是因为「哪些字段可以出网、哪些必须脱敏」是随不变量一起确定的：
 * 原始 token 永远不出现，指纹只出现前缀。
 */
export function refreshLogEntry(
  decision: RefreshDecision,
  refreshTokenHash: string,
  revokedSessions?: number,
): RefreshLogEntry | null {
  const refreshTokenHashPrefix = refreshTokenDigestPrefix(refreshTokenHash);
  switch (decision.kind) {
    case 'rotate':
      return null;
    case 'invalid':
      return {
        reason: decision.reason === 'expired' ? 'expired' : 'revoked',
        refreshTokenHashPrefix,
      };
    case 'concurrent-race':
      return {
        reason: 'concurrent-refresh',
        refreshTokenHashPrefix,
        userId: decision.userId,
        familyId: decision.familyId,
        rotatedAgoMs: decision.rotatedAgoMs,
      };
    case 'reuse-detected':
      return {
        reason: 'reuse-detected',
        refreshTokenHashPrefix,
        userId: decision.userId,
        familyId: decision.familyId,
        rotatedAgoMs: decision.rotatedAgoMs,
        ...(revokedSessions === undefined ? {} : { revokedSessions }),
      };
  }
}
