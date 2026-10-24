import { describe, expect, it } from 'vitest';

import {
  evaluateCredential,
  shouldCountLoginFailure,
  toCredentialFailure,
} from './credential-failures.js';
import type {
  CredentialDecision,
  CredentialFacts,
} from '../../domain/account/credential-verdict.js';

/**
 * 领域判定 → `DomainFailure` 映射的单测。
 *
 * ## 与 `domain/account/credential-verdict.spec.ts` 的分工
 *
 * 那个文件证明「判定本身把多种失败折叠成一个结论」；这个文件证明
 * **「那个结论被映射成了同一个错误码」**。两段都不能少：
 *
 * - 折叠正确但映射拆开 → 反枚举仍然破（例如给 `unknown-account` 单独一个码）；
 * - 映射正确但折叠错误 → 同样破。
 *
 * 这里刻意**不** mock 任何东西：mapper 是纯函数，输入是领域结论。
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

describe('toCredentialFailure', () => {
  it('所有 rejected reason 映射成同一个 AUTH_WRONG_PASSWORD', () => {
    const decisions: CredentialDecision[] = [
      { kind: 'rejected', reason: 'unknown-account' },
      { kind: 'rejected', reason: 'no-password' },
      { kind: 'rejected', reason: 'password-mismatch' },
      { kind: 'rejected', reason: 'code-mismatch' },
      { kind: 'rejected', reason: 'code-expired' },
      { kind: 'rejected', reason: 'ambiguous-credential' },
    ];

    const failures = decisions.map(toCredentialFailure);

    // 逐字相同：kind 与 code 都不能有差异。
    for (const failure of failures) {
      expect(failure.kind).toBe('authentication');
      expect(failure.code).toBe('AUTH_WRONG_PASSWORD');
    }
    expect(new Set(failures.map((f) => JSON.stringify(f))).size).toBe(1);
  });

  it('reason 绝不出现在失败里（否则就是枚举出口）', () => {
    for (const reason of [
      'unknown-account',
      'no-password',
      'password-mismatch',
      'code-mismatch',
      'code-expired',
      'ambiguous-credential',
    ] as const) {
      const failure = toCredentialFailure({ kind: 'rejected', reason });
      expect(JSON.stringify(failure)).not.toContain(reason);
    }
  });

  it('dependency-failed 映射成 DEPENDENCY_UNAVAILABLE，不是凭据失败', () => {
    for (const stage of [
      'account-lookup',
      'password-lookup',
      'password-compare',
      'code-verify',
    ] as const) {
      const failure = toCredentialFailure({
        kind: 'dependency-failed',
        stage,
      });

      expect(failure.kind).toBe('dependency');
      expect(failure.code).toBe('DEPENDENCY_UNAVAILABLE');
      expect(failure.code).not.toBe('AUTH_WRONG_PASSWORD');
    }
  });

  it('stage 进 detail（日志可见）但不进 code', () => {
    const failure = toCredentialFailure({
      kind: 'dependency-failed',
      stage: 'password-compare',
    });

    expect(failure.detail).toContain('password-compare');
    expect(failure.code).toBe('DEPENDENCY_UNAVAILABLE');
  });
});

describe('evaluateCredential', () => {
  it('accepted 时成功', async () => {
    const outcome = await evaluateCredential(
      facts({ passwordMatches: true }),
    ).match(
      () => 'ok' as const,
      () => 'err' as const,
    );
    expect(outcome).toBe('ok');
  });

  it('rejected 时失败且码是 AUTH_WRONG_PASSWORD', async () => {
    const failure = await evaluateCredential(
      facts({ passwordMatches: false }),
    ).match(
      () => null,
      (error) => error,
    );

    expect(failure?.code).toBe('AUTH_WRONG_PASSWORD');
  });

  it('dependency-failed 时失败且码是 DEPENDENCY_UNAVAILABLE', async () => {
    const failure = await evaluateCredential(
      facts({ dependencyFailure: 'account-lookup' }),
    ).match(
      () => null,
      (error) => error,
    );

    expect(failure?.code).toBe('DEPENDENCY_UNAVAILABLE');
  });
});

describe('shouldCountLoginFailure', () => {
  it('rejected 计入，dependency-failed 与 accepted 不计入', () => {
    expect(
      shouldCountLoginFailure({ kind: 'rejected', reason: 'unknown-account' }),
    ).toBe(true);
    expect(
      shouldCountLoginFailure({
        kind: 'dependency-failed',
        stage: 'account-lookup',
      }),
    ).toBe(false);
    expect(shouldCountLoginFailure({ kind: 'accepted' })).toBe(false);
  });
});
