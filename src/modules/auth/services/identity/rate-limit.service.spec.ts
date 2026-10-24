import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { describe, expect, it, beforeEach, vi } from 'vitest';

import { AuthRateLimitService } from './rate-limit.service.js';
import { FailureCounters } from '../../application/ports/failure-counters.js';
import {
  CAPTCHA_THRESHOLD,
  LOGIN_FAILURE_LOCKOUT_MS,
  LOGIN_FAILURE_MAX,
  LOGIN_FAILURE_WINDOW_MS,
  type FailureBucket,
} from '../../domain/policies/login-failures.js';

/**
 * 限流应用服务的单测。
 *
 * ## 这里测什么，不测什么
 *
 * 桶的转移规则（窗口、阈值、锁号）由
 * `domain/policies/login-failures.spec.ts` 纯单测钉住。本文件测**编排**：
 * key 怎么拼、读写顺序、结论怎么折成错误码、缓存故障是否保留原样。
 *
 * 用**手写替身**而不是 `vi.mock`：替身 `extends FailureCounters`，
 * 接口一变替身编译就断。
 */

class FakeCounters extends FailureCounters {
  readonly store = new Map<string, unknown>();
  readonly reads: string[] = [];
  readonly writes: { key: string; value: unknown; ttlMs: number }[] = [];
  readonly clears: string[] = [];
  /** 让 `read` 失败，验证缓存故障不被伪装成「没有记录」。 */
  readError: unknown = null;

  read(key: string): Promise<unknown> {
    this.reads.push(key);
    if (this.readError !== null) {
      return Promise.reject(
        this.readError instanceof Error
          ? this.readError
          : new Error('read failed'),
      );
    }
    return Promise.resolve(this.store.get(key) ?? null);
  }

  write(key: string, value: unknown, ttlMs: number): Promise<void> {
    this.writes.push({ key, value, ttlMs });
    this.store.set(key, value);
    return Promise.resolve();
  }

  clear(key: string): Promise<void> {
    this.clears.push(key);
    this.store.delete(key);
    return Promise.resolve();
  }
}

function hashEmail(email: string): string {
  return createHash('sha256').update(email).digest('hex');
}

describe('AuthRateLimitService', () => {
  let counters: FakeCounters;
  let service: AuthRateLimitService;
  const email = 'who@example.com';

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    counters = new FakeCounters();
    service = new AuthRateLimitService(counters);
  });

  describe('checkLoginRateLimit', () => {
    it('没有记录 → 放行', async () => {
      const outcome = await service.checkLoginRateLimit(email).match(
        () => 'ok',
        (e) => e.code,
      );
      expect(outcome).toBe('ok');
    });

    it('锁号期内 → AUTH_LOGIN_RATE_LIMITED，带 retryAfter 与 minutes', async () => {
      counters.store.set(`auth:login-failure:${hashEmail(email)}`, {
        count: LOGIN_FAILURE_MAX,
        resetAt: Date.now() + LOGIN_FAILURE_WINDOW_MS,
        lockedUntil: Date.now() + 90_000,
      });

      const failure = await service.checkLoginRateLimit(email).match(
        () => null,
        (e) => e,
      );

      expect(failure?.code).toBe('AUTH_LOGIN_RATE_LIMITED');
      expect(failure?.kind).toBe('rate_limited');
      expect(failure?.retryable).toBe(true);
      expect(failure?.retryAfter).toBeGreaterThan(0);
      expect(failure?.args?.['minutes']).toBeGreaterThan(0);
    });

    it('窗口过期（未锁号）→ 放行', async () => {
      counters.store.set(`auth:login-failure:${hashEmail(email)}`, {
        count: LOGIN_FAILURE_MAX,
        resetAt: Date.now() - 1,
      });

      const outcome = await service.checkLoginRateLimit(email).match(
        () => 'ok',
        (e) => e.code,
      );
      expect(outcome).toBe('ok');
    });

    it('形状损坏的桶 → 放行（不让它把窗口无限续期）', async () => {
      counters.store.set(`auth:login-failure:${hashEmail(email)}`, {
        garbage: true,
      });

      const outcome = await service.checkLoginRateLimit(email).match(
        () => 'ok',
        (e) => e.code,
      );
      expect(outcome).toBe('ok');
    });

    it('**缓存故障原样上抛**，不伪装成「没有记录」', async () => {
      // 返回「没有记录」等于限流静默失效——把依赖故障说成正常状态。
      counters.readError = new Error('cache down');

      const failure = await service.checkLoginRateLimit(email).match(
        () => null,
        (e) => e,
      );

      expect(failure?.code).toBe('DEPENDENCY_UNAVAILABLE');
      expect(failure?.kind).toBe('dependency');
    });

    it('按邮箱的 sha256 分桶（不落明文邮箱）', async () => {
      await service.checkLoginRateLimit(email);
      expect(counters.reads[0]).toBe(`auth:login-failure:${hashEmail(email)}`);
      expect(counters.reads[0]).not.toContain('@');
    });
  });

  describe('recordLoginFailure', () => {
    it('首次失败 → 开新桶计数 1，TTL 为窗口', async () => {
      await service.recordLoginFailure(email);

      expect(counters.writes).toHaveLength(1);
      const written = counters.writes[0]!;
      expect(written.key).toBe(`auth:login-failure:${hashEmail(email)}`);
      expect(written.value).toMatchObject({ count: 1 });
      expect(written.ttlMs).toBeGreaterThan(LOGIN_FAILURE_WINDOW_MS - 5_000);
    });

    it('累加已有计数', async () => {
      counters.store.set(`auth:login-failure:${hashEmail(email)}`, {
        count: 4,
        resetAt: Date.now() + LOGIN_FAILURE_WINDOW_MS,
      });

      await service.recordLoginFailure(email);

      expect(counters.writes[0]?.value).toMatchObject({ count: 5 });
    });

    it('达到上限 → 设置 lockedUntil，且 TTL 覆盖锁号（比窗口长）', async () => {
      counters.store.set(`auth:login-failure:${hashEmail(email)}`, {
        count: LOGIN_FAILURE_MAX - 1,
        resetAt: Date.now() + LOGIN_FAILURE_WINDOW_MS,
      });

      await service.recordLoginFailure(email);

      const written = counters.writes[0]!;
      expect(written.value).toMatchObject({ count: LOGIN_FAILURE_MAX });
      expect((written.value as FailureBucket).lockedUntil).toBeGreaterThan(
        Date.now(),
      );
      // 锁号（1h）比窗口（15min）长，TTL 必须取较大值。
      expect(written.ttlMs).toBeGreaterThan(LOGIN_FAILURE_WINDOW_MS);
      expect(written.ttlMs).toBeLessThanOrEqual(
        LOGIN_FAILURE_LOCKOUT_MS + 5_000,
      );
    });

    it('窗口过期 → 重新开桶', async () => {
      counters.store.set(`auth:login-failure:${hashEmail(email)}`, {
        count: 9,
        resetAt: Date.now() - 1,
      });

      await service.recordLoginFailure(email);
      expect(counters.writes[0]?.value).toMatchObject({ count: 1 });
    });

    it('已在锁号期 → 重开桶但不延长锁号', async () => {
      counters.store.set(`auth:login-failure:${hashEmail(email)}`, {
        count: LOGIN_FAILURE_MAX,
        resetAt: Date.now() + LOGIN_FAILURE_WINDOW_MS,
        lockedUntil: Date.now() + 60_000,
      });

      await service.recordLoginFailure(email);

      const value = counters.writes[0]?.value as FailureBucket;
      expect(value.count).toBe(1);
      expect(value.lockedUntil).toBeUndefined();
    });

    it('缓存读故障原样上抛', async () => {
      counters.readError = new Error('cache down');

      const failure = await service.recordLoginFailure(email).match(
        () => null,
        (e) => e,
      );
      expect(failure?.code).toBe('DEPENDENCY_UNAVAILABLE');
    });
  });

  describe('clearLoginFailures', () => {
    it('删除该邮箱的桶', async () => {
      await service.clearLoginFailures(email);
      expect(counters.clears).toEqual([
        `auth:login-failure:${hashEmail(email)}`,
      ]);
    });
  });

  describe('isCaptchaRequired — 与限流读同一个桶', () => {
    it('达到阈值 → 要求', async () => {
      counters.store.set(`auth:login-failure:${hashEmail(email)}`, {
        count: CAPTCHA_THRESHOLD,
        resetAt: Date.now() + LOGIN_FAILURE_WINDOW_MS,
      });

      const required = await service.isCaptchaRequired(email).match(
        (v) => v,
        () => null,
      );
      expect(required).toBe(true);
    });

    it('阈值之下 → 不要求', async () => {
      counters.store.set(`auth:login-failure:${hashEmail(email)}`, {
        count: CAPTCHA_THRESHOLD - 1,
        resetAt: Date.now() + LOGIN_FAILURE_WINDOW_MS,
      });

      const required = await service.isCaptchaRequired(email).match(
        (v) => v,
        () => null,
      );
      expect(required).toBe(false);
    });

    it('窗口过期 → 不要求（用户隔很久再来不该付验证成本）', async () => {
      counters.store.set(`auth:login-failure:${hashEmail(email)}`, {
        count: CAPTCHA_THRESHOLD,
        resetAt: Date.now() - 1,
      });

      const required = await service.isCaptchaRequired(email).match(
        (v) => v,
        () => null,
      );
      expect(required).toBe(false);
    });

    it('读的是与限流相同的 key', async () => {
      await service.isCaptchaRequired(email);
      expect(counters.reads[0]).toBe(`auth:login-failure:${hashEmail(email)}`);
    });

    it('读故障时上抛依赖故障（由调用方决定放行）', async () => {
      counters.readError = new Error('cache down');

      const failure = await service.isCaptchaRequired(email).match(
        () => null,
        (e) => e,
      );
      expect(failure?.code).toBe('DEPENDENCY_UNAVAILABLE');
    });
  });

  describe('密码重验路径（按 userId 分桶）', () => {
    it('锁号期内 → 通用 RATE_LIMITED（不是 AUTH_LOGIN_RATE_LIMITED）', async () => {
      counters.store.set('auth:reauth-failure:user-1', {
        count: LOGIN_FAILURE_MAX,
        resetAt: Date.now() + LOGIN_FAILURE_WINDOW_MS,
        lockedUntil: Date.now() + 60_000,
      });

      const failure = await service.checkReauthRateLimit('user-1').match(
        () => null,
        (e) => e,
      );

      expect(failure?.code).toBe('RATE_LIMITED');
      expect(failure?.kind).toBe('rate_limited');
      expect(failure?.retryAfter).toBeGreaterThan(0);
    });

    it('记失败与清零走 userId 的 key', async () => {
      await service.recordReauthFailure('user-1');
      await service.clearReauthFailures('user-1');

      expect(counters.writes[0]?.key).toBe('auth:reauth-failure:user-1');
      expect(counters.clears).toEqual(['auth:reauth-failure:user-1']);
    });

    it('两条路径的 key 不互相污染', async () => {
      await service.recordLoginFailure(email);
      await service.recordReauthFailure('user-1');

      expect(counters.writes[0]?.key).not.toBe(counters.writes[1]?.key);
      expect(counters.store.size).toBe(2);
    });
  });
});
