import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { I18nService } from 'nestjs-i18n';
import { randomInt } from 'node:crypto';

import { ResultCode } from '../common/api-envelope';
import { MailService } from '../mail/mail.service';
import type { VerificationScene } from './dto/send-verification-code.dto';

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const COOLDOWN_TTL_MS = 60 * 1000; // 60 seconds
/** Cooldown period in seconds (exposed for API response) */
export const VERIFICATION_CODE_COOLDOWN_SEC = COOLDOWN_TTL_MS / 1000;
const CODE_LENGTH = 6;

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
   * 内部处理频率限制（60s cooldown）。
   */
  async send(email: string, scene: VerificationScene): Promise<void> {
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
}
