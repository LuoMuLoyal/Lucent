import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { createHash } from 'node:crypto';

import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result';

const LOGIN_RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX = 10;
const LOGIN_RATE_LIMIT_LOCKOUT = 60 * 60 * 1000;

export interface LoginFailureBucket {
  count: number;
  resetAt: number;
  lockedUntil?: number;
}

/** Builds the cache key for a login failure bucket. */
export function loginFailureCacheKey(email: string): string {
  const digest = createHash('sha256').update(email).digest('hex');
  return `auth:login-failure:${digest}`;
}

/** Builds the cache key for a password re-authentication failure bucket. */
export function reauthFailureCacheKey(userId: string): string {
  return `auth:reauth-failure:${userId}`;
}

@Injectable()
export class AuthRateLimitService {
  private readonly logger = new Logger(AuthRateLimitService.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  /**
   * 检查登录限流。账户处于锁定窗口时返回
   * AUTH_LOGIN_RATE_LIMITED（携带 retryAfter 与动态 minutes）；
   * 窗口过期或缓存格式损坏时删除旧条目并放行。
   * 缓存故障保留原始异常向边界抛出，不得静默吞掉。
   */
  checkLoginRateLimit(email: string): ResultAsync<void, DomainFailure> {
    const key = loginFailureCacheKey(email);

    return this.lift(this.cacheGet(key)).andThen((value) => {
      const entry = value as LoginFailureBucket | undefined;
      if (!entry) return okAsync(undefined);

      if (entry.lockedUntil && entry.lockedUntil > Date.now()) {
        const lockedMs = entry.lockedUntil - Date.now();
        return errAsync(
          createDomainFailure({
            kind: 'rate_limited',
            code: 'AUTH_LOGIN_RATE_LIMITED',
            retryable: true,
            retryAfter: Math.ceil(lockedMs / 1000),
            args: { minutes: Math.ceil(lockedMs / 60_000) },
          }),
        );
      }

      if (
        !this.isValidLoginFailureBucket(entry) ||
        entry.resetAt <= Date.now()
      ) {
        return this.lift(this.cacheDel(key));
      }

      return okAsync(undefined);
    });
  }

  recordLoginFailure(email: string): ResultAsync<void, DomainFailure> {
    const key = loginFailureCacheKey(email);
    const now = Date.now();

    return this.lift(this.cacheGet(key)).andThen((value) => {
      const entry = value as LoginFailureBucket | undefined;

      if (
        !this.isValidLoginFailureBucket(entry) ||
        entry.resetAt <= now ||
        entry.lockedUntil !== undefined
      ) {
        return this.lift(
          this.cacheSet(
            key,
            { count: 1, resetAt: now + LOGIN_RATE_LIMIT_WINDOW },
            LOGIN_RATE_LIMIT_WINDOW,
          ),
        );
      }

      const next: LoginFailureBucket = {
        count: entry.count + 1,
        resetAt: entry.resetAt,
        ...(entry.count + 1 >= LOGIN_RATE_LIMIT_MAX && {
          lockedUntil: now + LOGIN_RATE_LIMIT_LOCKOUT,
        }),
      };
      const ttl = Math.max(
        next.resetAt - now,
        (next.lockedUntil ?? next.resetAt) - now,
      );
      return this.lift(this.cacheSet(key, next, ttl));
    });
  }

  clearLoginFailures(email: string): ResultAsync<void, DomainFailure> {
    return this.lift(this.cacheDel(loginFailureCacheKey(email)));
  }

  /**
   * 检查密码再认证限流。逻辑与登录限流一致，但按 userId 分桶并返回通用
   * `RATE_LIMITED`（携带 retryAfter）。
   */
  checkReauthRateLimit(userId: string): ResultAsync<void, DomainFailure> {
    const key = reauthFailureCacheKey(userId);

    return this.lift(this.cacheGet(key)).andThen((value) => {
      const entry = value as LoginFailureBucket | undefined;
      if (!entry) return okAsync(undefined);

      if (entry.lockedUntil && entry.lockedUntil > Date.now()) {
        const lockedMs = entry.lockedUntil - Date.now();
        return errAsync(
          createDomainFailure({
            kind: 'rate_limited',
            code: 'RATE_LIMITED',
            retryable: true,
            retryAfter: Math.ceil(lockedMs / 1000),
          }),
        );
      }

      if (
        !this.isValidLoginFailureBucket(entry) ||
        entry.resetAt <= Date.now()
      ) {
        return this.lift(this.cacheDel(key));
      }

      return okAsync(undefined);
    });
  }

  recordReauthFailure(userId: string): ResultAsync<void, DomainFailure> {
    const key = reauthFailureCacheKey(userId);
    const now = Date.now();

    return this.lift(this.cacheGet(key)).andThen((value) => {
      const entry = value as LoginFailureBucket | undefined;

      if (
        !this.isValidLoginFailureBucket(entry) ||
        entry.resetAt <= now ||
        entry.lockedUntil !== undefined
      ) {
        return this.lift(
          this.cacheSet(
            key,
            { count: 1, resetAt: now + LOGIN_RATE_LIMIT_WINDOW },
            LOGIN_RATE_LIMIT_WINDOW,
          ),
        );
      }

      const next: LoginFailureBucket = {
        count: entry.count + 1,
        resetAt: entry.resetAt,
        ...(entry.count + 1 >= LOGIN_RATE_LIMIT_MAX && {
          lockedUntil: now + LOGIN_RATE_LIMIT_LOCKOUT,
        }),
      };
      const ttl = Math.max(
        next.resetAt - now,
        (next.lockedUntil ?? next.resetAt) - now,
      );
      return this.lift(this.cacheSet(key, next, ttl));
    });
  }

  clearReauthFailures(userId: string): ResultAsync<void, DomainFailure> {
    return this.lift(this.cacheDel(reauthFailureCacheKey(userId)));
  }

  /**
   * 将缓存 IO 提升为 ResultAsync。缓存故障保留原始异常向边界抛出，
   * 不得把基础设施故障伪装成业务失败。
   */
  private lift<T>(promise: Promise<T>): ResultAsync<T, DomainFailure> {
    return fromPromise(promise, (error) => {
      throw error;
    });
  }

  private async cacheGet(key: string): Promise<unknown> {
    try {
      return await this.cache.get(key);
    } catch (error) {
      this.logger.warn(
        `Login rate-limit cache get failed (key=${key}): ${String(error)}`,
      );
      throw error;
    }
  }

  private async cacheSet(
    key: string,
    value: unknown,
    ttl: number,
  ): Promise<void> {
    try {
      await this.cache.set(key, value, ttl);
    } catch (error) {
      this.logger.warn(
        `Login rate-limit cache set failed (key=${key}): ${String(error)}`,
      );
      throw error;
    }
  }

  private async cacheDel(key: string): Promise<void> {
    try {
      await this.cache.del(key);
    } catch (error) {
      this.logger.warn(
        `Login rate-limit cache delete failed (key=${key}): ${String(error)}`,
      );
      throw error;
    }
  }

  private isValidLoginFailureBucket(
    bucket: unknown,
  ): bucket is LoginFailureBucket {
    if (typeof bucket !== 'object' || bucket === null) return false;
    const candidate = bucket as Partial<LoginFailureBucket>;
    return (
      typeof candidate.count === 'number' &&
      typeof candidate.resetAt === 'number' &&
      (candidate.lockedUntil === undefined ||
        typeof candidate.lockedUntil === 'number')
    );
  }
}
