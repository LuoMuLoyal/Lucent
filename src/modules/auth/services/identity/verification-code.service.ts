import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { RedisService } from '../../../../common';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result';
import { ConfigKey } from '../../../../config/env/config-keys.enum';
import type { YamlConfig } from '../../../../config/yaml/yaml-loader';
import { MailService } from '../../../../mail/mail.service';
import type { VerificationScene } from '../../dto/password/send-verification-code.dto';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

/**
 * Manages product-level anti-abuse verification codes for register, login,
 * set-password, change-email, and delete-account flows. Codes are stored in
 * cache (not the database) and are distinct from Better Auth's Verification
 * table tokens used for email verification and password reset.
 */
@Injectable()
export class VerificationCodeService {
  private static readonly CACHE_KEY_PREFIX = 'vcode';

  private readonly logger = new Logger(VerificationCodeService.name);

  private readonly codeTtlMs: number;
  private readonly cooldownTtlMs: number;
  private readonly rateLimitWindowMs: number;
  private readonly rateLimitMaxRequests: number;
  private readonly codeLength: number;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    const yaml = this.configService.getOrThrow<YamlConfig>(ConfigKey.Yaml);
    this.codeTtlMs = yaml.verification.codeTtlMs;
    this.cooldownTtlMs = yaml.verification.cooldownMs;
    this.rateLimitWindowMs = yaml.verification.rateLimitWindowMs;
    this.rateLimitMaxRequests = yaml.verification.rateLimitMax;
    this.codeLength = yaml.verification.codeLength;
  }

  /** Cooldown period in seconds (exposed for API response). */
  getCooldownSec(): number {
    return Math.floor(this.cooldownTtlMs / 1000);
  }

  /**
   * 生成并发送验证码。
   * 内部处理客户端窗口限流和同邮箱 cooldown。
   *
   * 预期业务失败以 DomainFailure 返回：客户端窗口超限使用
   * AUTH_VERIFICATION_CODE_RATE_LIMITED，冷却使用
   * AUTH_VERIFICATION_CODE_COOLDOWN。缓存/Redis/邮件等基础设施故障
   * 保留原始异常向边界抛出，不得伪装成“发送成功”或业务限流。
   */
  send(
    email: string,
    scene: VerificationScene,
    clientKey?: string,
  ): ResultAsync<void, DomainFailure> {
    return this.assertClientRateLimit(clientKey).andThen(() =>
      this.issueCodeAndSend(email, scene),
    );
  }

  assertClientRateLimit(clientKey?: string): ResultAsync<void, DomainFailure> {
    const effectiveKey = clientKey || 'unknown';
    const key = this.clientRateLimitKey(effectiveKey);

    // Prefer atomic Redis INCR when available — eliminates the race
    // condition where concurrent requests could all read the same stale
    // count and bypass the limit.
    if (this.redisService.isAvailable) {
      return this.lift(
        this.redisService.atomicIncrement(key, this.rateLimitWindowMs),
      ).andThen((count) => {
        if (count > this.rateLimitMaxRequests) {
          return errAsync(
            createDomainFailure({
              kind: 'rate_limited',
              code: 'AUTH_VERIFICATION_CODE_RATE_LIMITED',
              retryable: true,
              // Conservative estimate: the Redis window has no per-request
              // resetAt, so advertise the full window as the retry delay.
              retryAfter: Math.ceil(this.rateLimitWindowMs / 1000),
            }),
          );
        }
        return okAsync(undefined);
      });
    }

    // Fall back to non-atomic cache-based rate limiting when Redis is
    // not directly available (e.g. in-memory cache in test/dev).
    const now = Date.now();
    return this.lift(this.cacheGet(key)).andThen((value) => {
      const bucket = value as RateLimitBucket | undefined;

      if (!this.isValidBucket(bucket) || bucket.resetAt <= now) {
        return this.lift(
          this.cacheSet(
            key,
            { count: 1, resetAt: now + this.rateLimitWindowMs },
            this.rateLimitWindowMs,
          ),
        );
      }

      if (bucket.count >= this.rateLimitMaxRequests) {
        return errAsync(
          createDomainFailure({
            kind: 'rate_limited',
            code: 'AUTH_VERIFICATION_CODE_RATE_LIMITED',
            retryable: true,
            retryAfter: Math.max(0, Math.ceil((bucket.resetAt - now) / 1000)),
          }),
        );
      }

      return this.lift(
        this.cacheSet(
          key,
          { count: bucket.count + 1, resetAt: bucket.resetAt },
          bucket.resetAt - now,
        ),
      );
    });
  }

  /**
   * 校验验证码。成功后自动删除（一次性）。
   *
   * 过期返回 AUTH_VERIFICATION_CODE_EXPIRED，不匹配返回
   * AUTH_VERIFICATION_CODE_MISMATCH；校验成功返回 ok(undefined)。
   */
  verify(
    email: string,
    code: string,
    scene: VerificationScene,
  ): ResultAsync<void, DomainFailure> {
    const codeKey = this.codeKey(scene, email);

    return this.lift(this.cacheGet(codeKey)).andThen((value) => {
      const storedHash = value as string | undefined;

      if (!storedHash) {
        return errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_VERIFICATION_CODE_EXPIRED',
          }),
        );
      }

      if (!this.safeCompareCode(code, storedHash, scene, email)) {
        return errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_VERIFICATION_CODE_MISMATCH',
          }),
        );
      }

      // Delete after successful verification (one-time use)
      return this.lift(this.cacheDel(codeKey)).map(() => undefined);
    });
  }

  // ── Private Helpers ──────────────────────────────────────────

  private issueCodeAndSend(
    email: string,
    scene: VerificationScene,
  ): ResultAsync<void, DomainFailure> {
    const cooldownKey = this.cooldownKey(scene, email);

    return this.lift(this.cacheGet(cooldownKey)).andThen((inCooldown) => {
      if (inCooldown) {
        return errAsync(
          createDomainFailure({
            kind: 'rate_limited',
            code: 'AUTH_VERIFICATION_CODE_COOLDOWN',
            retryable: true,
            retryAfter: this.getCooldownSec(),
          }),
        );
      }

      const code = this.generateCode();
      const codeKey = this.codeKey(scene, email);

      // Store code hash in cache (never store plaintext codes)
      return this.lift(
        this.cacheSet(
          codeKey,
          this.hashCode(code, scene, email),
          this.codeTtlMs,
        ),
      )
        .andThen(() =>
          this.lift(this.cacheSet(cooldownKey, '1', this.cooldownTtlMs)),
        )
        .andThen(() =>
          this.lift(this.mailService.sendVerificationCode(email, code)),
        )
        .map(() => {
          this.logger.log(
            `Verification code sent: scene=${scene}, email=${email}`,
          );
        });
    });
  }

  /**
   * 将缓存/Redis/邮件等非 Prisma IO 提升为 ResultAsync。
   * 这些基础设施故障不是可恢复的业务失败：保留原始异常向边界抛出，
   * 由全局 filter 处理，不得把依赖故障伪装成业务失败。
   */
  private lift<T>(promise: Promise<T>): ResultAsync<T, DomainFailure> {
    return fromPromise(promise, (error) => {
      throw error;
    });
  }

  private generateCode(): string {
    const num = randomInt(0, 10 ** this.codeLength);
    return num.toString().padStart(this.codeLength, '0');
  }

  private hashCode(code: string, scene: string, email: string): string {
    return createHash('sha256')
      .update(`${scene}:${email}:${code}`)
      .digest('hex');
  }

  private safeCompareCode(
    code: string,
    storedHash: string,
    scene: string,
    email: string,
  ): boolean {
    const inputHash = this.hashCode(code, scene, email);
    const a = Buffer.from(inputHash);
    const b = Buffer.from(storedHash);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private codeKey(scene: string, email: string): string {
    return `${VerificationCodeService.CACHE_KEY_PREFIX}:${scene}:${email}`;
  }

  private cooldownKey(scene: string, email: string): string {
    return `${VerificationCodeService.CACHE_KEY_PREFIX}:cd:${scene}:${email}`;
  }

  private clientRateLimitKey(clientKey: string): string {
    const digest = createHash('sha256').update(clientKey).digest('hex');
    return `${VerificationCodeService.CACHE_KEY_PREFIX}:rl:client:${digest}`;
  }

  private isValidBucket(bucket: unknown): bucket is RateLimitBucket {
    if (typeof bucket !== 'object' || bucket === null) {
      return false;
    }

    const candidate = bucket as Partial<RateLimitBucket>;
    return (
      typeof candidate.count === 'number' &&
      typeof candidate.resetAt === 'number'
    );
  }

  private async cacheGet(key: string): Promise<unknown> {
    try {
      return await this.cache.get(key);
    } catch (error) {
      this.logger.warn(
        `Verification-code cache get failed (key=${key}): ${String(error)}`,
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
        `Verification-code cache set failed (key=${key}): ${String(error)}`,
      );
      throw error;
    }
  }

  private async cacheDel(key: string): Promise<void> {
    try {
      await this.cache.del(key);
    } catch (error) {
      this.logger.warn(
        `Verification-code cache delete failed (key=${key}): ${String(error)}`,
      );
      throw error;
    }
  }
}
