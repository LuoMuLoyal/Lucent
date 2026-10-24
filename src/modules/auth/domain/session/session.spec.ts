import { describe, expect, it } from 'vitest';

import {
  classifyRefreshReuse,
  REFRESH_REUSE_GRACE_MS,
  refreshTokenDigestPrefix,
  hashRefreshToken,
} from './refresh-token.js';
import {
  decideRefresh,
  refreshLogEntry,
  SESSION_FAMILY_ROOT,
  type SessionState,
} from './session.js';

/**
 * 会话聚合的纯领域单测。
 *
 * 不 mock Prisma、不建 DI 容器：这里验证的是安全不变量本身，与存储无关。
 * 仓储怎么实现、事务怎么开，都不该让「重放是否撤销整族」这个判断变形。
 */
describe('hashRefreshToken', () => {
  it('是 64 位十六进制摘要，且同样输入得到同样结果', () => {
    const a = hashRefreshToken('token-a');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken('token-a')).toBe(a);
  });

  it('不同 token 摘要不同', () => {
    expect(hashRefreshToken('token-a')).not.toBe(hashRefreshToken('token-b'));
  });

  it('摘要前缀只留 12 位，够关联日志但不足以反查', () => {
    const hash = hashRefreshToken('token-a');
    expect(refreshTokenDigestPrefix(hash)).toBe(`${hash.slice(0, 12)}…`);
    expect(refreshTokenDigestPrefix(hash).length).toBeLessThan(hash.length);
  });
});

describe('classifyRefreshReuse', () => {
  const at = new Date('2026-10-24T12:00:00.000Z');

  it('宽限窗口内视为并发竞态', () => {
    const rotatedAt = new Date(at.getTime() - 2_000);
    expect(classifyRefreshReuse(rotatedAt, at)).toBe('concurrent-race');
  });

  it('恰好落在窗口边界上仍算竞态', () => {
    // 边界取「小于等于」：网络往返抖动会把合法轮换推到边界附近，
    // 差一毫秒就判盗用会让双标签页用户随机掉线。
    const rotatedAt = new Date(at.getTime() - REFRESH_REUSE_GRACE_MS);
    expect(classifyRefreshReuse(rotatedAt, at)).toBe('concurrent-race');
  });

  it('窗口外视为盗用', () => {
    const rotatedAt = new Date(at.getTime() - REFRESH_REUSE_GRACE_MS - 1);
    expect(classifyRefreshReuse(rotatedAt, at)).toBe('reuse-detected');
  });

  it('窗口必须足够小，否则被盗 token 的可用时间被拉长', () => {
    expect(REFRESH_REUSE_GRACE_MS).toBeLessThanOrEqual(30_000);
    expect(REFRESH_REUSE_GRACE_MS).toBeGreaterThan(0);
  });
});

function session(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: 'session-1',
    userId: 'user-1',
    refreshTokenHash: hashRefreshToken('refresh-token'),
    familyId: 'family-1',
    expiresAt: new Date('2026-10-25T12:00:00.000Z'),
    revokedAt: null,
    rotatedAt: null,
    ...overrides,
  };
}

describe('decideRefresh', () => {
  const at = new Date('2026-10-24T12:00:00.000Z');

  it('未轮换、未吊销、未过期 → 可轮换，带出族根', () => {
    expect(decideRefresh(session(), at)).toEqual({
      kind: 'rotate',
      userId: 'user-1',
      familyId: 'family-1',
    });
  });

  it('已过期 → invalid(expired)', () => {
    expect(
      decideRefresh(session({ expiresAt: new Date(at.getTime() - 1) }), at),
    ).toEqual({ kind: 'invalid', reason: 'expired' });
  });

  it('过期时刻恰好等于判定时刻也算过期', () => {
    // 「有效到 expiresAt」是闭区间末端，等于即失效：宁可多拒一次刷新，
    // 也不能让一条到期 token 再换出一个完整会话。
    expect(
      decideRefresh(session({ expiresAt: new Date(at.getTime()) }), at),
    ).toEqual({ kind: 'invalid', reason: 'expired' });
  });

  it('已吊销 → invalid(revoked)', () => {
    expect(
      decideRefresh(session({ revokedAt: new Date(at.getTime() - 5_000) }), at),
    ).toEqual({ kind: 'invalid', reason: 'revoked' });
  });

  it('吊销优先于轮换判定', () => {
    // 已吊销的行再去判「是不是盗用」毫无意义，反而会重复撤销并污染告警。
    const state = session({
      revokedAt: new Date(at.getTime() - 1_000),
      rotatedAt: new Date(at.getTime() - 600_000),
    });
    expect(decideRefresh(state, at)).toEqual({
      kind: 'invalid',
      reason: 'revoked',
    });
  });

  it('宽限窗口内重放 → concurrent-race，不撤销整族', () => {
    const decision = decideRefresh(
      session({ rotatedAt: new Date(at.getTime() - 1_000) }),
      at,
    );

    expect(decision).toEqual({
      kind: 'concurrent-race',
      userId: 'user-1',
      familyId: 'family-1',
      rotatedAgoMs: 1_000,
    });
  });

  it('窗口外重放 → reuse-detected，携带整族撤销所需的键', () => {
    const decision = decideRefresh(
      session({ rotatedAt: new Date(at.getTime() - 120_000) }),
      at,
    );

    expect(decision).toEqual({
      kind: 'reuse-detected',
      userId: 'user-1',
      familyId: 'family-1',
      rotatedAgoMs: 120_000,
    });
  });

  it('宽限窗口的另一侧：边界值仍算竞态', () => {
    const decision = decideRefresh(
      session({ rotatedAt: new Date(at.getTime() - REFRESH_REUSE_GRACE_MS) }),
      at,
    );
    expect(decision.kind).toBe('concurrent-race');
  });
});

describe('refreshLogEntry', () => {
  const hash = hashRefreshToken('refresh-token');

  it('成功轮换不打日志', () => {
    expect(
      refreshLogEntry(
        { kind: 'rotate', userId: 'user-1', familyId: 'f' },
        hash,
      ),
    ).toBeNull();
  });

  it('原始 token 永不出现在日志里，指纹只留前缀', () => {
    const entry = refreshLogEntry({ kind: 'invalid', reason: 'expired' }, hash);
    expect(entry).not.toBeNull();
    expect(JSON.stringify(entry)).not.toContain(hash);
    expect(entry?.refreshTokenHashPrefix).toBe(`${hash.slice(0, 12)}…`);
  });

  it('盗用日志带族根与撤销条数，便于对账', () => {
    const entry = refreshLogEntry(
      {
        kind: 'reuse-detected',
        userId: 'user-1',
        familyId: 'family-9',
        rotatedAgoMs: 120_000,
      },
      hash,
      3,
    );
    expect(entry).toMatchObject({
      reason: 'reuse-detected',
      userId: 'user-1',
      familyId: 'family-9',
      revokedSessions: 3,
    });
  });

  it('竞态日志与盗用日志可区分', () => {
    const race = refreshLogEntry(
      {
        kind: 'concurrent-race',
        userId: 'user-1',
        familyId: 'family-1',
        rotatedAgoMs: 1_000,
      },
      hash,
    );
    expect(race?.reason).toBe('concurrent-refresh');
    expect(race?.revokedSessions).toBeUndefined();
  });
});

describe('SESSION_FAMILY_ROOT', () => {
  it('是语义常量而不是空值', () => {
    // 仓储端口上 familyId 是非空 string：族根永远不缺席。
    expect(SESSION_FAMILY_ROOT).toBe('self');
  });
});
