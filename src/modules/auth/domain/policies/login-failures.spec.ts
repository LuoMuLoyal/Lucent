import { describe, expect, it } from 'vitest';

import {
  bucketTtlMs,
  CAPTCHA_THRESHOLD,
  evaluateBucket,
  isBucketLive,
  isCaptchaRequired,
  isLockedOut,
  LOGIN_FAILURE_LOCKOUT_MS,
  LOGIN_FAILURE_MAX,
  LOGIN_FAILURE_WINDOW_MS,
  recordFailure,
  type FailureBucket,
} from './login-failures.js';

/**
 * 登录失败桶状态机的**纯单测**。
 *
 * 时间以毫秒数传入，所以窗口与锁号边界可以精确断言，不需要假时钟、不建 DI
 * 容器、不 mock 缓存。
 *
 * 两条不变量在这里钉住：
 * - 限流阈值与锁号（`AUTH_LOGIN_RATE_LIMITED` 的判据）；
 * - **人机验证读同一个桶**（`CAPTCHA_THRESHOLD` < `LOGIN_FAILURE_MAX`）。
 */

const AT = 1_700_000_000_000;

function bucket(overrides: Partial<FailureBucket> = {}): FailureBucket {
  return {
    count: 1,
    resetAt: AT + LOGIN_FAILURE_WINDOW_MS,
    ...overrides,
  };
}

describe('常量关系', () => {
  it('验证阈值远低于锁号上限', () => {
    // 验证是廉价闸门、锁号是最后手段：正常用户很少连错三次密码，
    // 而连错十次基本可以确定不是本人。
    expect(CAPTCHA_THRESHOLD).toBeLessThan(LOGIN_FAILURE_MAX);
  });

  it('锁号比窗口长（所以 TTL 必须取较大值）', () => {
    expect(LOGIN_FAILURE_LOCKOUT_MS).toBeGreaterThan(LOGIN_FAILURE_WINDOW_MS);
  });
});

describe('isBucketLive', () => {
  it('undefined 不活', () => {
    expect(isBucketLive(undefined, AT)).toBe(false);
  });

  it('窗口未过期则活，恰好到期即不活', () => {
    expect(isBucketLive(bucket({ resetAt: AT + 1 }), AT)).toBe(true);
    expect(isBucketLive(bucket({ resetAt: AT }), AT)).toBe(false);
    expect(isBucketLive(bucket({ resetAt: AT - 1 }), AT)).toBe(false);
  });

  it('形状损坏（count/resetAt 不是数字）判为不活', () => {
    // 缓存里可能有旧格式或损坏值，不能让它把窗口无限续期。
    expect(isBucketLive({ count: 'x', resetAt: AT + 1000 } as never, AT)).toBe(
      false,
    );
    expect(isBucketLive({ count: 1, resetAt: 'y' } as never, AT)).toBe(false);
  });
});

describe('isLockedOut', () => {
  it('锁号期内为真，边界恰好到期即为假', () => {
    expect(isLockedOut(bucket({ lockedUntil: AT + 1 }), AT)).toBe(true);
    expect(isLockedOut(bucket({ lockedUntil: AT }), AT)).toBe(false);
  });

  it('没有 lockedUntil 为假', () => {
    expect(isLockedOut(bucket(), AT)).toBe(false);
  });

  it('锁号可以晚于窗口结束（桶仍算「锁着」）', () => {
    const locked = bucket({
      resetAt: AT - 1,
      lockedUntil: AT + LOGIN_FAILURE_LOCKOUT_MS,
    });
    expect(isBucketLive(locked, AT)).toBe(false);
    expect(isLockedOut(locked, AT)).toBe(true);
  });
});

describe('evaluateBucket — 限流判据', () => {
  it('没有桶 → allowed', () => {
    expect(evaluateBucket(undefined, AT)).toEqual({ kind: 'allowed' });
  });

  it('锁号期内 → locked，带 retryAfter 与 minutes', () => {
    const verdict = evaluateBucket(bucket({ lockedUntil: AT + 90_000 }), AT);

    expect(verdict).toEqual({
      kind: 'locked',
      retryAfterSeconds: 90,
      minutes: 2,
    });
  });

  it('**锁号优先于计数**：已锁号但计数未到上限也拒绝', () => {
    // 顺序反了会让「已锁号但计数看起来没到阈值」的桶放行。
    const verdict = evaluateBucket(
      bucket({ count: 1, lockedUntil: AT + 1000 }),
      AT,
    );
    expect(verdict.kind).toBe('locked');
  });

  it('窗口过期（未锁号）→ allowed', () => {
    expect(evaluateBucket(bucket({ resetAt: AT - 1 }), AT)).toEqual({
      kind: 'allowed',
    });
  });

  it('未锁号的桶 → allowed（阈值由 isCaptchaRequired 单独判定）', () => {
    expect(evaluateBucket(bucket({ count: 9 }), AT)).toEqual({
      kind: 'allowed',
    });
  });
});

describe('isCaptchaRequired — 人机验证读同一个桶', () => {
  it('达到阈值即为真', () => {
    expect(isCaptchaRequired(bucket({ count: CAPTCHA_THRESHOLD }), AT)).toBe(
      true,
    );
  });

  it('阈值下一条为假', () => {
    expect(
      isCaptchaRequired(bucket({ count: CAPTCHA_THRESHOLD - 1 }), AT),
    ).toBe(false);
  });

  it('没有桶 → 不要求', () => {
    expect(isCaptchaRequired(undefined, AT)).toBe(false);
  });

  it('窗口过期 → 不再要求（用户隔很久再来不该付验证成本）', () => {
    expect(
      isCaptchaRequired(
        bucket({ count: CAPTCHA_THRESHOLD, resetAt: AT - 1 }),
        AT,
      ),
    ).toBe(false);
  });

  it('与限流读同一个桶：同一份计数同时驱动两个判据', () => {
    // 各算一套会出现「限流说锁了、验证说没到阈值」这种互相矛盾的组合。
    let current: FailureBucket | undefined;
    const captchaAt: number[] = [];

    for (let attempt = 1; attempt <= LOGIN_FAILURE_MAX; attempt += 1) {
      current = recordFailure(current, AT);
      if (isCaptchaRequired(current, AT)) captchaAt.push(attempt);
    }

    // 第 3 次开始要求验证，并持续到第 10 次（锁号）。
    expect(captchaAt[0]).toBe(CAPTCHA_THRESHOLD);
    expect(captchaAt).toHaveLength(LOGIN_FAILURE_MAX - CAPTCHA_THRESHOLD + 1);
    expect(evaluateBucket(current, AT).kind).toBe('locked');
  });
});

describe('recordFailure', () => {
  it('没有桶 → 开新桶计数 1', () => {
    expect(recordFailure(undefined, AT)).toEqual({
      count: 1,
      resetAt: AT + LOGIN_FAILURE_WINDOW_MS,
    });
  });

  it('未到上限 → 计数 +1，窗口不变', () => {
    const next = recordFailure(bucket({ count: 4 }), AT);
    expect(next.count).toBe(5);
    expect(next.resetAt).toBe(AT + LOGIN_FAILURE_WINDOW_MS);
    expect(next.lockedUntil).toBeUndefined();
  });

  it('达到上限 → 设置 lockedUntil', () => {
    const next = recordFailure(bucket({ count: LOGIN_FAILURE_MAX - 1 }), AT);
    expect(next.count).toBe(LOGIN_FAILURE_MAX);
    expect(next.lockedUntil).toBe(AT + LOGIN_FAILURE_LOCKOUT_MS);
  });

  it('窗口过期 → 重新开桶（不累加旧窗口的计数）', () => {
    const next = recordFailure(bucket({ count: 9, resetAt: AT - 1 }), AT);
    expect(next).toEqual({
      count: 1,
      resetAt: AT + LOGIN_FAILURE_WINDOW_MS,
    });
  });

  it('**锁号期内重开桶**：不延长锁号，也不把计数带进新窗口', () => {
    const locked = bucket({
      count: LOGIN_FAILURE_MAX,
      lockedUntil: AT + 60_000,
    });
    const next = recordFailure(locked, AT);

    expect(next).toEqual({
      count: 1,
      resetAt: AT + LOGIN_FAILURE_WINDOW_MS,
    });
    // 锁号没有被延长。
    expect(next.lockedUntil).toBeUndefined();
  });

  it('返回新对象，不就地改（避免调用方忘记写回）', () => {
    const original = bucket({ count: 1 });
    const next = recordFailure(original, AT);
    expect(original.count).toBe(1);
    expect(next).not.toBe(original);
  });

  it('连续失败在阈值处触发验证、在上限处触发锁号', () => {
    let current: FailureBucket | undefined;

    for (let attempt = 1; attempt < LOGIN_FAILURE_MAX; attempt += 1) {
      current = recordFailure(current, AT);
      // 阈值之下不要求验证，达到阈值之后要求。
      expect(isCaptchaRequired(current, AT)).toBe(attempt >= CAPTCHA_THRESHOLD);
      // 未到上限就不锁号。
      expect(evaluateBucket(current, AT).kind).toBe('allowed');
    }

    current = recordFailure(current, AT);
    expect(evaluateBucket(current, AT).kind).toBe('locked');
  });
});

describe('bucketTtlMs', () => {
  it('取窗口剩余与锁号剩余的较大值', () => {
    // 锁号（1h）比窗口（15min）长；TTL 取窗口剩余会让锁号提前消失。
    const locked = bucket({
      lockedUntil: AT + LOGIN_FAILURE_LOCKOUT_MS,
    });
    expect(bucketTtlMs(locked, AT)).toBe(LOGIN_FAILURE_LOCKOUT_MS);
  });

  it('未锁号时等于窗口剩余', () => {
    expect(bucketTtlMs(bucket(), AT)).toBe(LOGIN_FAILURE_WINDOW_MS);
  });

  it('下限为 1ms（0/负数在各后端语义不一致）', () => {
    const stale = bucket({ resetAt: AT - 10_000, lockedUntil: AT - 5_000 });
    expect(bucketTtlMs(stale, AT)).toBe(1);
  });
});
