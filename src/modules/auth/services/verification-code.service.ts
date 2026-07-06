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
import { I18nService } from 'nestjs-i18n';
import { createHash, randomInt } from 'node:crypto';

import { ResultCode } from '../../../common/api';
import { MailService } from '../../../mail/mail.service';
import type { VerificationScene } from '../dto/send-verification-code.dto';

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const COOLDOWN_TTL_MS = 60 * 1000; // 60 seconds
/** Cooldown period in seconds (exposed for API response) */
export const VERIFICATION_CODE_COOLDOWN_SEC = COOLDOWN_TTL_MS / 1000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX_REQUESTS = 20;
export const VERIFICATION_CODE_RATE_LIMIT_WINDOW_SEC =
  RATE_LIMIT_WINDOW_MS / 1000;
export const VERIFICATION_CODE_RATE_LIMIT_MAX_REQUESTS =
  RATE_LIMIT_MAX_REQUESTS;
const CODE_LENGTH = 6;

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class VerificationCodeService {
  private readonly logger = new Logger(VerificationCodeService.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly mailService: MailService,
    private readonly i18n: I18nService,
  ) {}

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

    // Store code in cache
    await this.cache.set(codeKey, code, CODE_TTL_MS);

    // Set cooldown
    await this.cache.set(cooldownKey, '1', COOLDOWN_TTL_MS);

    // Send email
    await this.mailService.sendVerificationCode(email, code);

    this.logger.log(`Verification code sent: scene=${scene}, email=${email}`);
  }

  async assertClientRateLimit(clientKey?: string): Promise<void> {
    if (!clientKey) {
      return;
    }

    const key = this.clientRateLimitKey(clientKey);
    const now = Date.now();
    const bucket = await this.cache.get<RateLimitBucket>(key);

    if (!this.isValidBucket(bucket) || bucket.resetAt <= now) {
      await this.cache.set(
        key,
        { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS },
        RATE_LIMIT_WINDOW_MS,
      );
      return;
    }

    if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
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
    const stored = await this.cache.get<string>(codeKey);

    if (!stored) {
      throw new BadRequestException({
        code: ResultCode.VERIFICATION_CODE_INVALID,
        message: this.i18n.t('auth.verification_code_expired'),
      });
    }

    if (stored !== code) {
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
    const num = randomInt(0, 10 ** CODE_LENGTH);
    return num.toString().padStart(CODE_LENGTH, '0');
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
