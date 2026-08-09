import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { ResultCode, RedisService } from '../../../../common';
import {
  DEFAULT_VERIFICATION_CODE_LENGTH,
  DEFAULT_VERIFICATION_CODE_TTL_MS,
  DEFAULT_VERIFICATION_COOLDOWN_MS,
  DEFAULT_VERIFICATION_RATE_LIMIT_MAX,
  DEFAULT_VERIFICATION_RATE_LIMIT_WINDOW_MS,
} from '../../../../config/constants';
import { EnvKey } from '../../../../config/env/env-keys.enum';
import { MailService } from '../../../../mail/mail.service';
import type { VerificationScene } from '../../dto/password/send-verification-code.dto';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class VerificationCodeService {
  private readonly logger = new Logger(VerificationCodeService.name);

  private readonly codeTtlMs: number;
  private readonly cooldownTtlMs: number;
  private readonly rateLimitWindowMs: number;
  private readonly rateLimitMaxRequests: number;
  private readonly codeLength: number;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly mailService: MailService,
    private readonly i18n: I18nService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.codeTtlMs = this.configService.get<number>(
      EnvKey.VERIFICATION_CODE_TTL_MS,
      DEFAULT_VERIFICATION_CODE_TTL_MS,
    );
    this.cooldownTtlMs = this.configService.get<number>(
      EnvKey.VERIFICATION_COOLDOWN_MS,
      DEFAULT_VERIFICATION_COOLDOWN_MS,
    );
    this.rateLimitWindowMs = this.configService.get<number>(
      EnvKey.VERIFICATION_RATE_LIMIT_WINDOW_MS,
      DEFAULT_VERIFICATION_RATE_LIMIT_WINDOW_MS,
    );
    this.rateLimitMaxRequests = this.configService.get<number>(
      EnvKey.VERIFICATION_RATE_LIMIT_MAX,
      DEFAULT_VERIFICATION_RATE_LIMIT_MAX,
    );
    this.codeLength = this.configService.get<number>(
      EnvKey.VERIFICATION_CODE_LENGTH,
      DEFAULT_VERIFICATION_CODE_LENGTH,
    );
  }

  /** Cooldown period in seconds (exposed for API response). */
  getCooldownSec(): number {
    return Math.floor(this.cooldownTtlMs / 1000);
  }

  /**
   * 生成并发送验证码。
   * 内部处理客户端窗口限流和同邮箱 60s cooldown。
   */
  async send(
    email: string,
    scene: VerificationScene,
    clientKey?: string,
  ): Promise<void> {
    await this.assertClientRateLimit(clientKey);

    // Check cooldown
    const cooldownKey = this.cooldownKey(scene, email);
    const inCooldown = await this.cache.get(cooldownKey);
    if (inCooldown) {
      throw new BadRequestException({
        code: ResultCode.VERIFICATION_CODE_COOLDOWN,
        message: this.i18n.t('auth.verification_code_cooldown'),
      });
    }

    // Generate code
    const code = this.generateCode();
    const codeKey = this.codeKey(scene, email);

    // Store code hash in cache (never store plaintext codes)
    await this.cache.set(
      codeKey,
      this.hashCode(code, scene, email),
      this.codeTtlMs,
    );

    // Set cooldown
    await this.cache.set(cooldownKey, '1', this.cooldownTtlMs);

    // Send email
    await this.mailService.sendVerificationCode(email, code);

    this.logger.log(`Verification code sent: scene=${scene}, email=${email}`);
  }

  async assertClientRateLimit(clientKey?: string): Promise<void> {
    const effectiveKey = clientKey || 'unknown';
    const key = this.clientRateLimitKey(effectiveKey);

    // Prefer atomic Redis INCR when available — eliminates the race
    // condition where concurrent requests could all read the same stale
    // count and bypass the limit.
    if (this.redisService.isAvailable) {
      const count = await this.redisService.atomicIncrement(
        key,
        this.rateLimitWindowMs,
      );
      if (count > this.rateLimitMaxRequests) {
        throw new HttpException(
          {
            code: ResultCode.VERIFICATION_CODE_RATE_LIMITED,
            message: this.i18n.t('auth.verification_code_rate_limited'),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return;
    }

    // Fall back to non-atomic cache-based rate limiting when Redis is
    // not directly available (e.g. in-memory cache in test/dev).
    const now = Date.now();
    const bucket = await this.cache.get<RateLimitBucket>(key);

    if (!this.isValidBucket(bucket) || bucket.resetAt <= now) {
      await this.cache.set(
        key,
        { count: 1, resetAt: now + this.rateLimitWindowMs },
        this.rateLimitWindowMs,
      );
      return;
    }

    if (bucket.count >= this.rateLimitMaxRequests) {
      throw new HttpException(
        {
          code: ResultCode.VERIFICATION_CODE_RATE_LIMITED,
          message: this.i18n.t('auth.verification_code_rate_limited'),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.cache.set(
      key,
      { count: bucket.count + 1, resetAt: bucket.resetAt },
      bucket.resetAt - now,
    );
  }

  /**
   * 校验验证码。成功后自动删除（一次性）。
   * @returns true if valid
   */
  async verify(
    email: string,
    code: string,
    scene: VerificationScene,
  ): Promise<boolean> {
    const codeKey = this.codeKey(scene, email);
    const storedHash = await this.cache.get<string>(codeKey);

    if (!storedHash) {
      throw new BadRequestException({
        code: ResultCode.VERIFICATION_CODE_INVALID,
        message: this.i18n.t('auth.verification_code_expired'),
      });
    }

    if (!this.safeCompareCode(code, storedHash, scene, email)) {
      throw new UnauthorizedException({
        code: ResultCode.VERIFICATION_CODE_INVALID,
        message: this.i18n.t('auth.verification_code_wrong'),
      });
    }

    // Delete after successful verification (one-time use)
    await this.cache.del(codeKey);

    return true;
  }

  // ── Private Helpers ──────────────────────────────────────────

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
    return `vcode:${scene}:${email}`;
  }

  private cooldownKey(scene: string, email: string): string {
    return `vcode:cd:${scene}:${email}`;
  }

  private clientRateLimitKey(clientKey: string): string {
    const digest = createHash('sha256').update(clientKey).digest('hex');
    return `vcode:rl:client:${digest}`;
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
}
