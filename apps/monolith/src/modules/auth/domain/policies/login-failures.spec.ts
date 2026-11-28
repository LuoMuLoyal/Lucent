import { describe, expect, it } from 'vitest';

import {
  backoffDelayMs,
  bucketTtlMs,
  CAPTCHA_THRESHOLD,
  evaluateBucket,
  isBucketLive,
  isCaptchaRequired,
  LOGIN_FAILURE_MAX,
  LOGIN_FAILURE_WINDOW_MS,
  recordFailure,
  type FailureBucket,
} from './login-failures.js';

/**
 * 登录失败桶状态机的**纯单测**。
 *
 * 时间以毫秒数传入，所以窗口边界可以精确断言，不需要假时钟、不建 DI 容器、
 * 不 mock 缓存。
 *
 * 两条不变量在这里钉住：
 * - **登录侧永不拒绝**：失败次数只产生延迟，不产生「账号已锁」；
 * - **人机验证读同一个桶**（`CAPTCHA_THRESHOLD` 起开始要求）。
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
  it('验证阈值低于渐进延迟的起始点', () => {
    // 验证是廉价闸门，延迟是持续成本：验证应更早介入。
    expect(CAPTCHA_THRESHOLD).toBeLessThan(LOGIN_FAILURE_MAX);
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

describe('backoffDelayMs', () => {
  it('阈值及以下不延迟', () => {
    expect(backoffDelayMs(0)).toBe(0);
    expect(backoffDelayMs(CAPTCHA_THRESHOLD)).toBe(0);
  });

  it('越过阈值后从 1s 起、每次翻倍', () => {
    expect(backoffDelayMs(CAPTCHA_THRESHOLD + 1)).toBe(1_000);
    expect(backoffDelayMs(CAPTCHA_THRESHOLD + 2)).toBe(2_000);
    expect(backoffDelayMs(CAPTCHA_THRESHOLD + 3)).toBe(4_000);
  });

  it('封顶，避免长尾把正常用户拖到无法忍受', () => {
    expect(backoffDelayMs(CAPTCHA_THRESHOLD + 40)).toBe(30_000);
  });
});

describe('evaluateBucket — 永不拒绝', () => {
  it('没有桶 → allowed 且无延迟', () => {
    expect(evaluateBucket(undefined, AT)).toEqual({
      kind: 'allowed',
      delayMs: 0,
      captchaRequired: false,
    });
  });

  it('窗口过期 → allowed 且无延迟（不累加旧窗口代价）', () => {
    expect(evaluateBucket(bucket({ resetAt: AT - 1 }), AT)).toEqual({
      kind: 'allowed',
      delayMs: 0,
      captchaRequired: false,
    });
  });

  it('**大量失败也只延迟、不拒绝**', () => {
    // 这是防「知道邮箱就能锁死他人账号」的核心断言。
    const verdict = evaluateBucket(bucket({ count: 999 }), AT);

    expect(verdict.kind).toBe('allowed');
    expect(verdict.delayMs).toBe(30_000);
    expect(verdict.captchaRequired).toBe(true);
  });

  it('遗留的 lockedUntil 字段不会导致拒绝（兼容旧数据）', () => {
    const legacy = bucket({ count: 12, lockedUntil: AT + 3_600_000 });
    expect(evaluateBucket(legacy, AT).kind).toBe('allowed');
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
    let current: FailureBucket | undefined;
    const captchaAt: number[] = [];

    for (let attempt = 1; attempt <= LOGIN_FAILURE_MAX; attempt += 1) {
      current = recordFailure(current, AT);
      if (isCaptchaRequired(current, AT)) captchaAt.push(attempt);
    }

    expect(captchaAt[0]).toBe(CAPTCHA_THRESHOLD);
    expect(captchaAt).toHaveLength(LOGIN_FAILURE_MAX - CAPTCHA_THRESHOLD + 1);
  });
});

describe('recordFailure', () => {
  it('没有桶 → 开新桶计数 1', () => {
    expect(recordFailure(undefined, AT)).toEqual({
      count: 1,
      resetAt: AT + LOGIN_FAILURE_WINDOW_MS,
    });
  });

  it('窗口内 → 计数 +1，窗口不变，且不写 lockedUntil', () => {
    const next = recordFailure(bucket({ count: 4 }), AT);
    expect(next.count).toBe(5);
    expect(next.resetAt).toBe(AT + LOGIN_FAILURE_WINDOW_MS);
    expect(next.lockedUntil).toBeUndefined();
  });

  it('达到旧上限也不再锁号', () => {
    const next = recordFailure(bucket({ count: LOGIN_FAILURE_MAX - 1 }), AT);
    expect(next.count).toBe(LOGIN_FAILURE_MAX);
    expect(next.lockedUntil).toBeUndefined();
  });

  it('窗口过期 → 重新开桶（不累加旧窗口的计数）', () => {
    const next = recordFailure(bucket({ count: 9, resetAt: AT - 1 }), AT);
    expect(next).toEqual({
      count: 1,
      resetAt: AT + LOGIN_FAILURE_WINDOW_MS,
    });
  });

  it('返回新对象，不就地改（避免调用方忘记写回）', () => {
    const original = bucket({ count: 1 });
    const next = recordFailure(original, AT);
    expect(original.count).toBe(1);
    expect(next).not.toBe(original);
  });

  it('连续失败：验证按阈值出现，且永远是 allowed', () => {
    let current: FailureBucket | undefined;

    for (let attempt = 1; attempt <= LOGIN_FAILURE_MAX + 5; attempt += 1) {
      current = recordFailure(current, AT);
      expect(isCaptchaRequired(current, AT)).toBe(attempt >= CAPTCHA_THRESHOLD);
      expect(evaluateBucket(current, AT).kind).toBe('allowed');
    }
  });
});

describe('bucketTtlMs', () => {
  it('未锁号时等于窗口剩余', () => {
    expect(bucketTtlMs(bucket(), AT)).toBe(LOGIN_FAILURE_WINDOW_MS);
  });

  it('遗留 lockedUntil 晚于窗口时取较大值（让它自然过期而不是提前清掉）', () => {
    const legacy = bucket({ lockedUntil: AT + 3_600_000 });
    expect(bucketTtlMs(legacy, AT)).toBe(3_600_000);
  });

  it('下限为 1ms（0/负数在各后端语义不一致）', () => {
    const stale = bucket({ resetAt: AT - 10_000, lockedUntil: AT - 5_000 });
    expect(bucketTtlMs(stale, AT)).toBe(1);
  });
});
