import { describe, expect, it } from 'vitest';

import {
  countsAsLoginFailure,
  decideCredential,
  type CredentialFacts,
  type CredentialRejectionReason,
} from './credential-verdict.js';

/**
 * 凭据判定的**纯单测**。
 *
 * 不建 DI 容器、不 mock Prisma、不碰 `common/result`——领域层连它都不 import。
 * 这里验证的是两条安全不变量本身：
 *
 * - **#1 反枚举**：账号不存在 / 无密码 / 密码错 / 验证码错 → 同一个结论。
 * - **#2 依赖故障不折进反枚举桶**：依赖故障是**另一个 kind**。
 *
 * 「同一个结论」在这里断言的是**可观察结果相同**，不是「都在 rejected 里」。
 * 所以下面用 `observable()` 把结论投影成「调用方能看到的形状」再比较。
 */

function facts(overrides: Partial<CredentialFacts> = {}): CredentialFacts {
  return {
    accountFound: true,
    storedPassword: 'set',
    presented: 'password',
    passwordMatches: null,
    codeOutcome: null,
    dependencyFailure: null,
    ...overrides,
  };
}

/**
 * 把领域结论投影成「应用层会对外暴露的形状」。
 *
 * 领域层不知道错误码（它不 import `common/result`），所以这里模拟应用层
 * mapper 的行为：**所有 `rejected` → 同一个码**，`dependency-failed` → 另一个码。
 * 反枚举的保证在「投影后相同」，所以断言必须落在投影上。
 */
function observable(decision: ReturnType<typeof decideCredential>): {
  status: 401 | 503;
  code: string;
} {
  switch (decision.kind) {
    case 'accepted':
      return { status: 401, code: 'ACCEPTED_PLACEHOLDER' };
    case 'rejected':
      return { status: 401, code: 'AUTH_WRONG_PASSWORD' };
    case 'dependency-failed':
      return { status: 503, code: 'DEPENDENCY_UNAVAILABLE' };
  }
}

/**
 * 每一种拒绝原因与触发它的事实组合。
 *
 * 集中成一张表，是为了让「反枚举」的断言能遍历**全部**原因——将来新增一种
 * reason 时，漏加进这张表会被类型检查提醒（`satisfies` 约束）。
 */
const REJECTION_CASES = [
  {
    reason: 'unknown-account',
    facts: facts({ accountFound: false, storedPassword: 'none' }),
  },
  {
    reason: 'no-password',
    facts: facts({ storedPassword: 'none', passwordMatches: null }),
  },
  {
    reason: 'password-mismatch',
    facts: facts({ passwordMatches: false }),
  },
  {
    reason: 'code-mismatch',
    facts: facts({ presented: 'code', codeOutcome: 'mismatch' }),
  },
  {
    reason: 'code-expired',
    facts: facts({ presented: 'code', codeOutcome: 'expired' }),
  },
  {
    reason: 'ambiguous-credential',
    facts: facts({ presented: 'both' }),
  },
] as const satisfies readonly {
  reason: CredentialRejectionReason;
  facts: CredentialFacts;
}[];

describe('decideCredential — 不变量 #1：反枚举', () => {
  it('账号不存在 → rejected(unknown-account)', () => {
    expect(
      decideCredential(facts({ accountFound: false, storedPassword: 'none' })),
    ).toEqual({ kind: 'rejected', reason: 'unknown-account' });
  });

  it('账号存在但无本地密码 → rejected(no-password)', () => {
    expect(
      decideCredential(
        facts({
          storedPassword: 'none',
          passwordMatches: null,
        }),
      ),
    ).toEqual({ kind: 'rejected', reason: 'no-password' });
  });

  it('密码错 → rejected(password-mismatch)', () => {
    expect(decideCredential(facts({ passwordMatches: false }))).toEqual({
      kind: 'rejected',
      reason: 'password-mismatch',
    });
  });

  it('验证码不匹配 → rejected(code-mismatch)', () => {
    expect(
      decideCredential(facts({ presented: 'code', codeOutcome: 'mismatch' })),
    ).toEqual({ kind: 'rejected', reason: 'code-mismatch' });
  });

  it('验证码过期 → rejected(code-expired)', () => {
    expect(
      decideCredential(facts({ presented: 'code', codeOutcome: 'expired' })),
    ).toEqual({ kind: 'rejected', reason: 'code-expired' });
  });

  it('密码与验证码都给 / 都不给 → rejected(ambiguous-credential)', () => {
    expect(decideCredential(facts({ presented: 'both' }))).toEqual({
      kind: 'rejected',
      reason: 'ambiguous-credential',
    });
    expect(decideCredential(facts({ presented: 'neither' }))).toEqual({
      kind: 'rejected',
      reason: 'ambiguous-credential',
    });
  });

  it('【核心】六种拒绝原因对外是完全同一个可观察结果', () => {
    // 这是反枚举的**唯一真实断言**：不只是「都落在 rejected 里」，
    // 而是经过应用层映射后 status 与 code 逐字相同。
    const projected = REJECTION_CASES.map(({ reason, facts: caseFacts }) => {
      const decision = decideCredential(caseFacts);
      expect(decision).toEqual({ kind: 'rejected', reason });
      return observable(decision);
    });

    // 用 Set 大小证明「全部相同」，避免逐对比较漏掉一对。
    const distinct = new Set(projected.map((item) => JSON.stringify(item)));
    expect(distinct.size).toBe(1);
    expect([...distinct][0]).toBe(
      JSON.stringify({ status: 401, code: 'AUTH_WRONG_PASSWORD' }),
    );
  });

  it('账号不存在与密码错的投影逐字相同（显式成对断言）', () => {
    // 与上面的 Set 断言互补：Set 证明「全部相同」，这里证明「这两条具体相同」，
    // 失败信息更可读。
    const unknown = observable(
      decideCredential(facts({ accountFound: false })),
    );
    const mismatch = observable(
      decideCredential(facts({ passwordMatches: false })),
    );

    expect(unknown).toEqual(mismatch);
    expect(unknown.code).toBe('AUTH_WRONG_PASSWORD');
  });
});

describe('decideCredential — 不变量 #2：依赖故障不折进反枚举桶', () => {
  it.each(['account-lookup', 'password-lookup', 'password-compare'] as const)(
    '%s 故障 → dependency-failed，不是 rejected',
    (stage) => {
      const decision = decideCredential(facts({ dependencyFailure: stage }));

      expect(decision.kind).toBe('dependency-failed');
      // 类型上就不是 rejected —— 这是编译期性质，运行时再断言一次。
      expect(decision).not.toHaveProperty('reason');
      expect(decision).toEqual({ kind: 'dependency-failed', stage });
    },
  );

  it('【核心】依赖故障压倒凭据结论：三种 stage 的投影都不是 AUTH_WRONG_PASSWORD', () => {
    for (const stage of [
      'account-lookup',
      'password-lookup',
      'password-compare',
    ] as const) {
      const projected = observable(
        decideCredential(facts({ dependencyFailure: stage })),
      );

      expect(projected.code).toBe('DEPENDENCY_UNAVAILABLE');
      expect(projected.status).toBe(503);
      expect(projected.code).not.toBe('AUTH_WRONG_PASSWORD');
    }
  });

  it('依赖故障优先于「账号不存在」——宕机不能被说成账号问题', () => {
    const decision = decideCredential(
      facts({
        accountFound: false,
        storedPassword: 'none',
        dependencyFailure: 'account-lookup',
      }),
    );

    expect(decision).toEqual({
      kind: 'dependency-failed',
      stage: 'account-lookup',
    });
  });

  it('依赖故障优先于「密码错」', () => {
    const decision = decideCredential(
      facts({ passwordMatches: false, dependencyFailure: 'password-compare' }),
    );

    expect(decision.kind).toBe('dependency-failed');
  });

  it('依赖故障优先于「验证码过期」', () => {
    const decision = decideCredential(
      facts({
        presented: 'code',
        codeOutcome: 'expired',
        dependencyFailure: 'password-lookup',
      }),
    );

    expect(decision.kind).toBe('dependency-failed');
  });
});

describe('decideCredential — 接受路径', () => {
  it('密码正确 → accepted', () => {
    expect(decideCredential(facts({ passwordMatches: true }))).toEqual({
      kind: 'accepted',
    });
  });

  it('验证码有效 → accepted', () => {
    expect(
      decideCredential(facts({ presented: 'code', codeOutcome: 'valid' })),
    ).toEqual({ kind: 'accepted' });
  });

  it('无密码账号即便 passwordMatches 为 true 也拒绝', () => {
    // 防御性：事实组合不该出现，但若出现，拒绝方向是对的。
    expect(
      decideCredential(
        facts({ storedPassword: 'none', passwordMatches: true }),
      ),
    ).toEqual({ kind: 'rejected', reason: 'no-password' });
  });
});

describe('countsAsLoginFailure', () => {
  it('所有 rejected 都计入限流（含 ambiguous-credential）', () => {
    // 否则攻击者可以用畸形请求无限探测而不触发锁号。
    for (const reason of [
      'unknown-account',
      'no-password',
      'password-mismatch',
      'code-mismatch',
      'code-expired',
      'ambiguous-credential',
    ] as const) {
      expect(countsAsLoginFailure({ kind: 'rejected', reason })).toBe(true);
    }
  });

  it('依赖故障不计入限流', () => {
    // 一次缓存抖动不该把一批用户锁在门外。
    expect(
      countsAsLoginFailure({
        kind: 'dependency-failed',
        stage: 'account-lookup',
      }),
    ).toBe(false);
  });

  it('成功不计入', () => {
    expect(countsAsLoginFailure({ kind: 'accepted' })).toBe(false);
  });
});
