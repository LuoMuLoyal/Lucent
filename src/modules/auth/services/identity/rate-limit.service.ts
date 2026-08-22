import {
  Inject,
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { createHash } from 'node:crypto';
import { I18nService } from 'nestjs-i18n';

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
  private readonly logger = new Logger(AuthRateLimitService.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly i18n: I18nService,
  ) {}

  async checkLoginRateLimit(email: string): Promise<void> {
    const key = loginFailureCacheKey(email);
    const entry = (await this.cacheGet(key)) as LoginFailureBucket | undefined;
    if (!entry) return;

    if (entry.lockedUntil && entry.lockedUntil > Date.now()) {
      const minutes = Math.ceil((entry.lockedUntil - Date.now()) / 60_000);
      throw new HttpException(
        {
          code: 'AUTH_LOGIN_RATE_LIMITED',
          retryable: true,
          retryAfter: Math.ceil((entry.lockedUntil - Date.now()) / 1000),
          message: this.i18n.t('auth.login_rate_limited', {
            args: { minutes },
          }),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!this.isValidLoginFailureBucket(entry) || entry.resetAt <= Date.now()) {
      await this.cacheDel(key);
    }
  }

  async recordLoginFailure(email: string): Promise<void> {
    const key = loginFailureCacheKey(email);
    const now = Date.now();
    const entry = (await this.cacheGet(key)) as LoginFailureBucket | undefined;

    if (
      !this.isValidLoginFailureBucket(entry) ||
      entry.resetAt <= now ||
      entry.lockedUntil !== undefined
    ) {
      await this.cacheSet(
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
    await this.cacheSet(key, next, ttl);
  }

  async clearLoginFailures(email: string): Promise<void> {
    await this.cacheDel(loginFailureCacheKey(email));
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
