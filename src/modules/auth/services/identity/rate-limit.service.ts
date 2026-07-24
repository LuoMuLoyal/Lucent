import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { createHash } from 'node:crypto';
import { I18nService } from 'nestjs-i18n';
import { ResultCode } from '../../../../common';

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

@Injectable()
export class AuthRateLimitService {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly i18n: I18nService,
  ) {}

  async checkLoginRateLimit(email: string): Promise<void> {
    const key = loginFailureCacheKey(email);
    const entry = await this.cache.get<LoginFailureBucket>(key);
    if (!entry) return;

    if (entry.lockedUntil && entry.lockedUntil > Date.now()) {
      const minutes = Math.ceil((entry.lockedUntil - Date.now()) / 60_000);
      throw new UnauthorizedException({
        code: ResultCode.LOGIN_RATE_LIMITED,
        message: this.i18n.t('auth.login_rate_limited', { args: { minutes } }),
      });
    }

    if (!this.isValidLoginFailureBucket(entry) || entry.resetAt <= Date.now()) {
      await this.cache.del(key);
    }
  }

  async recordLoginFailure(email: string): Promise<void> {
    const key = loginFailureCacheKey(email);
    const now = Date.now();
    const entry = await this.cache.get<LoginFailureBucket>(key);

    if (
      !this.isValidLoginFailureBucket(entry) ||
      entry.resetAt <= now ||
      entry.lockedUntil !== undefined
    ) {
      await this.cache.set(
        key,
        { count: 1, resetAt: now + LOGIN_RATE_LIMIT_WINDOW },
        LOGIN_RATE_LIMIT_WINDOW,
      );
      return;
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
    await this.cache.set(key, next, ttl);
  }

  async clearLoginFailures(email: string): Promise<void> {
    await this.cache.del(loginFailureCacheKey(email));
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
