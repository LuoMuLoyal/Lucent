import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import {
  createDomainFailure,
  errAsync,
  fromPromise,
  mapUnknownToDependencyFailure,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import { FailureCounters } from '../../application/ports/failure-counters.js';
import {
  bucketTtlMs,
  CAPTCHA_THRESHOLD,
  evaluateBucket,
  isCaptchaRequired,
  recordFailure,
  type FailureBucket,
} from '../../domain/policies/login-failures.js';

export { CAPTCHA_THRESHOLD };

/** Builds the cache key for a login failure bucket (by email). */
export function loginFailureCacheKey(email: string): string {
  const digest = createHash('sha256').update(email).digest('hex');
  return `auth:login-failure:${digest}`;
}

/** Builds the cache key for a password re-authentication failure bucket. */
export function reauthFailureCacheKey(userId: string): string {
  return `auth:reauth-failure:${userId}`;
}

/**
 * 登录失败限流与「何时要求人机验证」的**应用服务**。
 *
 * ## 它只做「读写 + 映射」，判定全在策略里
 *
 * 桶的转移规则（窗口、阈值、锁号）在
 * `domain/policies/login-failures.ts`——那里是纯函数，可以精确单测窗口边界。
 * 本类负责：拼 key、从端口读写、把结论折成 `DomainFailure`。
 *
 * ## 两条路径共用同一套机制
 *
 * - **登录失败**按邮箱分桶（`loginFailureCacheKey`），失败返回
 *   `AUTH_LOGIN_RATE_LIMITED`（带 `retryAfter` 与动态 `minutes`）。
 * - **密码重验失败**按 userId 分桶（`reauthFailureCacheKey`），失败返回通用
 *   `RATE_LIMITED`（带 `retryAfter`）。
 *
 * 阈值相同、错误码不同：重验是**已认证用户**的敏感操作，客户端需要区分
 * 「登录被限流」与「重验被限流」以便给出不同提示。
 *
 * ## 缓存故障保留原始异常（不变量 #2）
 *
 * 读失败**不**返回「没有失败记录」——那等于限流静默失效。异常原样上抛，
 * 由调用方映射成 `DEPENDENCY_UNAVAILABLE`。
 */
@Injectable()
export class AuthRateLimitService {
  constructor(private readonly counters: FailureCounters) {}

  /**
   * 检查登录限流。账户处于锁定窗口时返回
   * `AUTH_LOGIN_RATE_LIMITED`（携带 `retryAfter` 与动态 `minutes`）。
   */
  checkLoginRateLimit(email: string): ResultAsync<void, DomainFailure> {
    return this.evaluate(loginFailureCacheKey(email)).andThen((verdict) =>
      verdict.kind === 'locked'
        ? errAsync(
            createDomainFailure({
              kind: 'rate_limited',
              code: 'AUTH_LOGIN_RATE_LIMITED',
              retryable: true,
              retryAfter: verdict.retryAfterSeconds,
              args: { minutes: verdict.minutes },
            }),
          )
        : okAsync(undefined),
    );
  }

  /**
   * 记一次登录失败。
   *
   * **无论客户端看到什么码，这里都要计数**——反枚举意味着客户端只看到
   * 统一的凭据失败，但限流必须知道真实失败次数。
   */
  recordLoginFailure(email: string): ResultAsync<void, DomainFailure> {
    return this.record(loginFailureCacheKey(email));
  }

  /** 登录成功或验证通过后清零。 */
  clearLoginFailures(email: string): ResultAsync<void, DomainFailure> {
    return this.clear(loginFailureCacheKey(email));
  }

  /**
   * 该邮箱在评估凭据之前是否必须先过人机验证。
   *
   * 读的就是限流器写的**同一个失败桶**，两个机制因此不会各算一套。
   */
  isCaptchaRequired(email: string): ResultAsync<boolean, DomainFailure> {
    const key = loginFailureCacheKey(email);
    return fromPromise(this.counters.read(key), (error) =>
      mapUnknownToDependencyFailure(error, 'Failed to read login failures'),
    ).map((raw) => isCaptchaRequired(toBucket(raw), Date.now()));
  }

  /**
   * 检查密码再认证限流。按 userId 分桶，返回通用 `RATE_LIMITED`。
   */
  checkReauthRateLimit(userId: string): ResultAsync<void, DomainFailure> {
    return this.evaluate(reauthFailureCacheKey(userId)).andThen((verdict) =>
      verdict.kind === 'locked'
        ? errAsync(
            createDomainFailure({
              kind: 'rate_limited',
              code: 'RATE_LIMITED',
              retryable: true,
              retryAfter: verdict.retryAfterSeconds,
            }),
          )
        : okAsync(undefined),
    );
  }

  recordReauthFailure(userId: string): ResultAsync<void, DomainFailure> {
    return this.record(reauthFailureCacheKey(userId));
  }

  clearReauthFailures(userId: string): ResultAsync<void, DomainFailure> {
    return this.clear(reauthFailureCacheKey(userId));
  }

  // ── 内部步骤 ─────────────────────────────────────────────────

  /** 读桶 → 策略判定。锁号结论由调用方折成各自的错误码。 */
  private evaluate(
    key: string,
  ): ResultAsync<ReturnType<typeof evaluateBucket>, DomainFailure> {
    return fromPromise(this.counters.read(key), (error) =>
      mapUnknownToDependencyFailure(error, 'Failed to read failure bucket'),
    ).map((raw) => evaluateBucket(toBucket(raw), Date.now()));
  }

  /** 读桶 → 记一次失败 → 按策略给的 TTL 写回。 */
  private record(key: string): ResultAsync<void, DomainFailure> {
    const now = Date.now();
    return fromPromise(this.counters.read(key), (error) =>
      mapUnknownToDependencyFailure(error, 'Failed to read failure bucket'),
    ).andThen((raw) => {
      const next = recordFailure(toBucket(raw), now);
      return fromPromise(
        this.counters.write(key, next, bucketTtlMs(next, now)),
        (error) =>
          mapUnknownToDependencyFailure(error, 'Failed to record failure'),
      );
    });
  }

  private clear(key: string): ResultAsync<void, DomainFailure> {
    return fromPromise(this.counters.clear(key), (error) =>
      mapUnknownToDependencyFailure(error, 'Failed to clear failures'),
    );
  }
}

/**
 * 缓存里的原始值 → 策略可判定的桶。
 *
 * 形状不可信时返回 `undefined`（等同「没有桶」）——**这与「缓存故障」不同**：
 * 故障在端口层就抛出了，到这里说明读到了值，只是格式不对（旧版本写入、
 * 人工改过）。格式错当没有记录处理，不让它把窗口无限续期。
 */
function toBucket(raw: unknown): FailureBucket | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const candidate = raw as Partial<FailureBucket>;
  if (typeof candidate.count !== 'number') return undefined;
  if (typeof candidate.resetAt !== 'number') return undefined;
  if (
    candidate.lockedUntil !== undefined &&
    typeof candidate.lockedUntil !== 'number'
  ) {
    return undefined;
  }
  return {
    count: candidate.count,
    resetAt: candidate.resetAt,
    ...(candidate.lockedUntil === undefined
      ? {}
      : { lockedUntil: candidate.lockedUntil }),
  };
}
