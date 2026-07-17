import {
  notFound,
  badRequest,
  unauthorized,
  conflict,
} from '../../../../common/helpers/api-errors';
import { normalizeEmail } from '../../../../common/helpers/string.utils';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import * as argon2 from 'argon2';

import { ARGON2_OPTIONS } from '../../config/argon2-options';
import { NotificationsService } from '../../../notifications/services/notifications.service';
import type { User } from '#generated/prisma/client';
import { UserStatus } from '#generated/prisma/client';
import { UserService } from '../../../user/services/user.service';
import { VerificationCodeService } from './verification-code.service';
import { ResultCode } from '../../../../common/api';
import { RegisterDto } from '../../dto/register.dto';
import { LoginDto } from '../../dto/login.dto';
import { ChangePasswordDto } from '../../dto/change-password.dto';
import { ChangeEmailDto } from '../../dto/change-email.dto';
import { ResetPasswordDto } from '../../dto/reset-password.dto';
import { SetPasswordDto } from '../../dto/set-password.dto';
import { ForgotPasswordDto } from '../../dto/forgot-password.dto';
import { SendVerificationCodeDto } from '../../dto/send-verification-code.dto';
import { VerifyEmailDto } from '../../dto/verify-email.dto';
import {
  AuthTokenService,
  type AuthRequestContext,
  type TokenPair,
} from '../token.service';
import { AuthRateLimitService } from './rate-limit.service';
import { now } from '../../../../common/helpers/date-time.utils';

/**
 * Handles email/password credential flows: registration, login,
 * password changes, email changes, password reset, and verification codes.
 */
@Injectable()
export class CredentialAuthService {
  private readonly logger = new Logger(CredentialAuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly verificationCodeService: VerificationCodeService,
    private readonly authTokenService: AuthTokenService,
    private readonly authRateLimitService: AuthRateLimitService,
    private readonly notificationsService: NotificationsService,
    private readonly i18n: I18nService,
  ) {}

  // ── Registration ─────────────────────────────────────────────

  async register(
    dto: RegisterDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    const email = normalizeEmail(dto.email);
    const exists = await this.userService.findByEmail(email);
    if (exists) {
      conflict(this.i18n.t('auth.email_already_registered'));
    }

    await this.verificationCodeService.verify(email, dto.code, 'register');

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);

    const user = await this.userService.create({
      email,
      passwordHash,
      nickname: dto.nickname ?? null,
      emailVerifiedAt: now(),
      profile: { create: {} },
    });

    const tokens = await this.authTokenService.generateTokenPair(user, context);
    return { user, ...tokens };
  }

  // ── Login ────────────────────────────────────────────────────

  async login(
    dto: LoginDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    const email = normalizeEmail(dto.email);
    await this.authRateLimitService.checkLoginRateLimit(email);

    const user = await this.userService.findByEmail(email);

    if (!user) {
      await this.authRateLimitService.recordLoginFailure(email);
      unauthorized(this.i18n.t('auth.email_or_password_wrong'));
    }

    const password = dto.password;
    const code = dto.code;
    const hasPassword = password !== undefined;
    const hasCode = code !== undefined;
    if (hasPassword === hasCode) {
      await this.authRateLimitService.recordLoginFailure(email);
      unauthorized(this.i18n.t('auth.email_or_password_wrong'));
    }

    if (hasPassword) {
      if (!user.passwordHash) {
        await this.authRateLimitService.recordLoginFailure(email);
        unauthorized(this.i18n.t('auth.email_or_password_wrong'));
      }

      const valid = await argon2.verify(user.passwordHash, password);
      if (!valid) {
        await this.authRateLimitService.recordLoginFailure(email);
        unauthorized(this.i18n.t('auth.email_or_password_wrong'));
      }
    }

    if (hasCode) {
      await this.verificationCodeService.verify(email, code, 'login');
    }

    await this.authRateLimitService.clearLoginFailures(email);

    const updatedUser = await this.userService.update(user.id, {
      lastLoginAt: now(),
      status: UserStatus.active,
    });

    const tokens = await this.authTokenService.generateTokenPair(
      updatedUser,
      context,
    );
    return { user: updatedUser, ...tokens };
  }

  // ── Password Management ──────────────────────────────────────

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this._getActiveUser(userId);
    if (!user.passwordHash) {
      throw new UnauthorizedException({
        code: ResultCode.WRONG_PASSWORD,
        message: this.i18n.t('auth.use_set_password_for_oauth_account'),
      });
    }

    const valid = await argon2.verify(user.passwordHash, dto.oldPassword);
    if (!valid) {
      throw new UnauthorizedException({
        code: ResultCode.WRONG_PASSWORD,
        message: this.i18n.t('auth.current_password_wrong'),
      });
    }
    const passwordHash = await argon2.hash(dto.newPassword, ARGON2_OPTIONS);
    await this.userService.update(userId, { passwordHash });
    await this.authTokenService.revokeAll(userId);
    await this._notifyPasswordChanged(userId);
  }

  async setPassword(userId: string, dto: SetPasswordDto): Promise<void> {
    const user = await this._getActiveUser(userId);
    if (user.passwordHash) {
      conflict(this.i18n.t('auth.password_already_set'));
    }

    const targetEmail = dto.email
      ? normalizeEmail(dto.email)
      : user.email
        ? normalizeEmail(user.email)
        : null;

    if (!targetEmail) {
      badRequest(this.i18n.t('auth.email_required_for_set_password'));
    }

    await this.verificationCodeService.verify(
      targetEmail,
      dto.code,
      'set-password',
    );

    if (!user.email) {
      const existingUser = await this.userService.findByEmail(targetEmail);
      if (existingUser && existingUser.id !== userId) {
        conflict(this.i18n.t('auth.email_in_use'));
      }
      await this.userService.update(userId, {
        email: targetEmail,
        emailVerifiedAt: now(),
      });
    }

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
    await this.userService.update(userId, { passwordHash });

    await this.authTokenService.revokeAll(userId);
    await this._notifyPasswordChanged(userId);
  }

  // ── Email Management ─────────────────────────────────────────

  async changeEmail(userId: string, dto: ChangeEmailDto): Promise<User> {
    await this._getActiveUser(userId);
    const newEmail = normalizeEmail(dto.newEmail);

    const exists = await this.userService.findByEmail(newEmail);
    if (exists) {
      conflict(this.i18n.t('auth.email_in_use'));
    }

    await this.verificationCodeService.verify(
      newEmail,
      dto.code,
      'change-email',
    );

    return this.userService.update(userId, {
      email: newEmail,
      emailVerifiedAt: now(),
    });
  }

  // ── Verification Code ────────────────────────────────────────

  async sendVerificationCode(
    dto: SendVerificationCodeDto,
    clientKey?: string,
  ): Promise<{ message: string }> {
    await this.verificationCodeService.send(
      normalizeEmail(dto.email),
      dto.scene,
      clientKey,
    );
    return { message: this.i18n.t('auth.verification_code_sent') };
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<void> {
    const email = normalizeEmail(dto.email);
    await this.verificationCodeService.verify(email, dto.code, 'register');
    await this.userService.updateByEmail(email, {
      emailVerifiedAt: now(),
    });
  }

  // ── Password Reset ───────────────────────────────────────────

  async forgotPassword(
    dto: ForgotPasswordDto,
    clientKey?: string,
  ): Promise<{ message: string }> {
    await this.verificationCodeService.assertClientRateLimit(clientKey);
    const email = normalizeEmail(dto.email);
    const user = await this.userService.findByEmail(email);
    if (user) {
      await this.verificationCodeService.send(email, 'reset-password');
    }
    return { message: this.i18n.t('auth.forgot_password_hint') };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const email = normalizeEmail(dto.email);
    await this.verificationCodeService.verify(
      email,
      dto.code,
      'reset-password',
    );
    const user = await this.userService.findByEmail(email);
    if (!user) {
      notFound(this.i18n.t('auth.user_not_found'));
    }
    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
    await this.userService.update(user.id, { passwordHash });
    await this.authTokenService.revokeAll(user.id);
  }

  // ── Helpers ──────────────────────────────────────────────────

  private async _getActiveUser(userId: string): Promise<User> {
    const user = await this.userService.findById(userId);
    if (!user) {
      notFound(this.i18n.t('auth.user_not_found'));
    }
    return user;
  }

  private async _notifyPasswordChanged(userId: string): Promise<void> {
    try {
      await this.notificationsService.create(userId, {
        type: 'password_changed',
        title: this.i18n.t('auth.password_changed_notification_title'),
        content: this.i18n.t('auth.password_changed_notification_content'),
        action: '/account',
      });
    } catch (error) {
      this.logger.warn('Notification delivery failed during password change', {
        userId,
        error,
      });
    }
  }
}
