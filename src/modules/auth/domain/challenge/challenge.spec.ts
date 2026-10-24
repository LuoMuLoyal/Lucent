import { describe, expect, it } from 'vitest';

import {
  MAX_CHALLENGE_ATTEMPTS,
  VerificationChallenge,
  type ChallengeState,
} from './challenge.js';
import { deriveCodeHash } from './verification-code.js';

/**
 * 验证码挑战聚合的**纯单测**。
 *
 * 不建 DI 容器、不碰缓存、不 mock Prisma——聚合只做判定，存储由调用方处理。
 * 这里钉住四条不变量：单次消费、尝试上限、用尽优先于比对、reason 不上浮。
 */

const SCENE = 'forgot-password';
const EMAIL = 'who@example.com';
const CODE = '123456';

function state(overrides: Partial<ChallengeState> = {}): ChallengeState {
  return {
    scene: SCENE,
    email: EMAIL,
    codeHash: deriveCodeHash(CODE, SCENE, EMAIL),
    attempts: 0,
    issuedAt: new Date('2026-10-25T00:00:00.000Z'),
    ...overrides,
  };
}

function challenge(overrides: Partial<ChallengeState> = {}) {
  return VerificationChallenge.from(state(overrides));
}

describe('VerificationChallenge — 正确码', () => {
  it('正确码 → accepted，且指示删除条目（单次消费）', () => {
    const result = challenge().verify(CODE);

    expect(result.verdict).toEqual({ kind: 'accepted' });
    expect(result.nextState).toBeNull();
  });

  it('前导零的码也能正确比对', () => {
    const zeroCode = '000123';
    const result = challenge({
      codeHash: deriveCodeHash(zeroCode, SCENE, EMAIL),
    }).verify(zeroCode);

    expect(result.verdict).toEqual({ kind: 'accepted' });
  });
});

describe('VerificationChallenge — 尝试次数上限（本次新增的不变量）', () => {
  it('上限是 5', () => {
    expect(MAX_CHALLENGE_ATTEMPTS).toBe(5);
  });

  it('前 4 次错码返回 mismatch 且计数递增', () => {
    let current = state();

    for (let attempt = 1; attempt < MAX_CHALLENGE_ATTEMPTS; attempt += 1) {
      const result = VerificationChallenge.from(current).verify('000000');

      expect(result.verdict).toEqual({
        kind: 'mismatch',
        remainingAttempts: MAX_CHALLENGE_ATTEMPTS - attempt,
      });
      expect(result.nextState?.attempts).toBe(attempt);
      current = result.nextState as ChallengeState;
    }
  });

  it('第 5 次错码 → exhausted，并把计数推到上限', () => {
    const result = challenge({ attempts: MAX_CHALLENGE_ATTEMPTS - 1 }).verify(
      '000000',
    );

    expect(result.verdict).toEqual({ kind: 'exhausted' });
    expect(result.nextState?.attempts).toBe(MAX_CHALLENGE_ATTEMPTS);
  });

  it('【核心】猜爆之后，正确的码也不再用', () => {
    // 这是本次变更的核心断言：上限生效之后，即便拿到真码也拒绝。
    // 若实现成「作废但仍比对」，攻击者猜满后仍能靠命中通过，上限就白做了。
    const exhausted = challenge({ attempts: MAX_CHALLENGE_ATTEMPTS });

    const result = exhausted.verify(CODE);

    expect(result.verdict).toEqual({ kind: 'exhausted' });
    expect(result.verdict.kind).not.toBe('accepted');
    expect(result.nextState).toBeNull();
  });

  it('计数超过上限（脏数据）仍判定 exhausted', () => {
    const result = challenge({ attempts: 999 }).verify(CODE);

    expect(result.verdict).toEqual({ kind: 'exhausted' });
  });

  it('isExhausted 的边界恰在上限处', () => {
    expect(
      challenge({ attempts: MAX_CHALLENGE_ATTEMPTS - 1 }).isExhausted,
    ).toBe(false);
    expect(challenge({ attempts: MAX_CHALLENGE_ATTEMPTS }).isExhausted).toBe(
      true,
    );
  });
});

describe('VerificationChallenge — 指纹绑定', () => {
  it('别的场景的码不通过', () => {
    // 指纹里含 scene，所以为 register 签发的码不能用于 forgot-password。
    const result = challenge().verify('123456');
    expect(result.verdict.kind).toBe('accepted');

    const otherScene = challenge({
      codeHash: deriveCodeHash(CODE, 'register', EMAIL),
    }).verify(CODE);
    // 码本身相同、但指纹是按 forgot-password 算的 → 不匹配。
    expect(otherScene.verdict.kind).toBe('mismatch');
  });

  it('别的邮箱的码不通过', () => {
    const otherEmail = challenge({
      codeHash: deriveCodeHash(CODE, SCENE, 'other@example.com'),
    }).verify(CODE);

    expect(otherEmail.verdict.kind).toBe('mismatch');
  });
});

describe('VerificationChallenge — 结论不上浮 reason 词汇', () => {
  it('失败结论不暴露「还剩几次」之外的任何计数细节', () => {
    // `remainingAttempts` 只在 mismatch 分支出现；accepted / exhausted 都没有。
    // 这是「不给攻击者进度条」的类型层表达。
    expect(Object.keys(challenge().verify(CODE).verdict)).toEqual(['kind']);
    expect(
      Object.keys(
        challenge({ attempts: MAX_CHALLENGE_ATTEMPTS }).verify(CODE).verdict,
      ),
    ).toEqual(['kind']);
  });

  it('聚合的 verdict 含 expired/exhausted，而凭据判定层不含', () => {
    // 两层的 reason 词汇刻意不同：聚合内部需要区分，凭据判定只需要
    // 「有效 / 无效」。这里断言聚合**有**这个词汇（S3 内部要用），
    // 而 `credential-verdict.spec.ts` 断言凭据层**没有**。
    const verdicts = [
      challenge().verify('000000').verdict,
      challenge({ attempts: MAX_CHALLENGE_ATTEMPTS }).verify(CODE).verdict,
    ];
    expect(verdicts.map((v) => v.kind)).toEqual(['mismatch', 'exhausted']);
  });
});

describe('VerificationChallenge — snapshot', () => {
  it('返回副本，外部改动不影响聚合', () => {
    const subject = challenge();
    const snapshot = subject.snapshot();
    snapshot.attempts = 99;

    expect(subject.attempts).toBe(0);
  });

  it('携带 scene 与 email，供应用层重算指纹', () => {
    // 指纹派生需要 scene+email，所以它们必须与码一起持久化。
    expect(challenge().snapshot()).toMatchObject({
      scene: SCENE,
      email: EMAIL,
    });
  });
});
