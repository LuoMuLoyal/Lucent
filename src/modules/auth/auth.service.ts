import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import * as argon2 from 'argon2';

import { ARGON2_OPTIONS } from './config/argon2-options';
import { PrismaService } from '../../prisma/prisma.service';
import { User, UserStatus } from '../../generated/prisma/client';
import { UserService } from '../user/user.service';
import { VerificationCodeService } from './services/verification-code.service';
import { ResultCode } from '../../common/api-envelope';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ChangeEmailDto } from './dto/change-email.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { SendVerificationCodeDto } from './dto/send-verification-code.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import {
  OAuthAuthorizeDto,
  OAuthCallbackDto,
  OAuthCodeCallbackDto,
} from './dto/oauth.dto';
import { WechatWebOAuthProvider } from './providers/wechat-web-oauth.provider';
import { WechatMobileOAuthProvider } from './providers/wechat-mobile-oauth.provider';
import {
  type OAuthAuthorizeResult,
  type OAuthProfile,
} from './types/oauth.types';
import {
  AuthOAuthStateService,
  type OAuthStateEntry,
} from './services/auth-oauth-state.service';
import {
  AuthTokenService,
  type AuthRequestContext,
  type TokenPair,
} from './services/auth-token.service';
import { AuthRateLimitService } from './services/auth-rate-limit.service';
import { AuthOAuthService } from './services/auth-oauth.service';

export type {
  AuthRequestContext,
  UserPayload,
} from './services/auth-token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly verificationCodeService: VerificationCodeService,
    private readonly wechatWebOAuthProvider: WechatWebOAuthProvider,
    private readonly wechatMobileOAuthProvider: WechatMobileOAuthProvider,
    private readonly i18n: I18nService,
    private readonly authRateLimitService: AuthRateLimitService,
    private readonly authTokenService: AuthTokenService,
    private readonly authOAuthStateService: AuthOAuthStateService,
    private readonly authOAuthService: AuthOAuthService,
  ) {}

  // ── Registration ─────────────────────────────────────────────

  async register(
    dto: RegisterDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    const email = this.normalizeEmail(dto.email);
    const exists = await this.userService.findByEmail(email);
    if (exists) {
      throw new ConflictException({
        code: ResultCode.CONFLICT,
        message: this.i18n.t('auth.email_already_registered'),
      });
    }

    await this.verificationCodeService.verify(email, dto.code, 'register');

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
    const now = new Date();

    const user = await this.userService.create({
      email,
      passwordHash,
      nickname: dto.nickname ?? null,
      emailVerifiedAt: now,
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
    const email = this.normalizeEmail(dto.email);
    await this.authRateLimitService.checkLoginRateLimit(email);

    const user = await this.userService.findByEmail(email);

    if (!user) {
      await this.authRateLimitService.recordLoginFailure(email);
      throw new UnauthorizedException({
        code: ResultCode.UNAUTHORIZED,
        message: this.i18n.t('auth.email_or_password_wrong'),
      });
    }

    const password = dto.password;
    const code = dto.code;
    const hasPassword = password !== undefined;
    const hasCode = code !== undefined;
    if (hasPassword === hasCode) {
      await this.authRateLimitService.recordLoginFailure(email);
      throw new UnauthorizedException({
        code: ResultCode.UNAUTHORIZED,
        message: this.i18n.t('auth.email_or_password_wrong'),
      });
    }

    // Password-based login
    if (hasPassword) {
      if (!user.passwordHash) {
        await this.authRateLimitService.recordLoginFailure(email);
        throw new UnauthorizedException({
          code: ResultCode.UNAUTHORIZED,
          message: this.i18n.t('auth.email_or_password_wrong'),
        });
      }

      const valid = await argon2.verify(user.passwordHash, password);
      if (!valid) {
        await this.authRateLimitService.recordLoginFailure(email);
        throw new UnauthorizedException({
          code: ResultCode.UNAUTHORIZED,
          message: this.i18n.t('auth.email_or_password_wrong'),
        });
      }
    }

    // Code-based login
    if (hasCode) {
      await this.verificationCodeService.verify(email, code, 'login');
    }
    // TODO(auth-security): add optional 2FA challenge verification before issuing tokens.
    // blocked: requires product decision on 2FA method (TOTP/SMS/email) and UX for setup/recovery flows.

    await this.authRateLimitService.clearLoginFailures(email);

    const now = new Date();
    const updatedUser = await this.userService.update(user.id, {
      lastLoginAt: now,
      status: UserStatus.active,
    });

    const tokens = await this.authTokenService.generateTokenPair(
      updatedUser,
      context,
    );
    return { user: updatedUser, ...tokens };
  }

  // ── Token Refresh ────────────────────────────────────────────

  async refresh(
    refreshToken: string,
    context?: AuthRequestContext,
  ): Promise<TokenPair> {
    try {
      return await this.authTokenService.refresh(refreshToken, context);
    } catch {
      throw new UnauthorizedException({
        code: ResultCode.REFRESH_TOKEN_INVALID,
        message: this.i18n.t('auth.refresh_token_invalid'),
      });
    }
  }

  // ── Logout ───────────────────────────────────────────────────

  async logout(userId: string, refreshToken: string): Promise<void> {
    await this.authTokenService.revoke(userId, refreshToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.authTokenService.revokeAll(userId);
  }
  // TODO(auth-session): expose device/session management so users can review and revoke individual sessions.
  // blocked: requires session-list API + UI, device fingerprinting strategy, and revoke-by-id endpoint.

  // ── Profile Management ───────────────────────────────────────

  async getActiveUser(userId: string): Promise<User> {
    const user = await this.userService.findById(userId);
    if (!user) {
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: this.i18n.t('auth.user_not_found'),
      });
    }
    return user;
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.getActiveUser(userId);
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
    await this.logoutAll(userId);
  }

  async setPassword(userId: string, dto: SetPasswordDto): Promise<void> {
    const user = await this.getActiveUser(userId);
    if (user.passwordHash) {
      throw new ConflictException({
        code: ResultCode.CONFLICT,
        message: this.i18n.t('auth.password_already_set'),
      });
    }

    // Determine target email: use provided email or existing user email
    const targetEmail = dto.email
      ? this.normalizeEmail(dto.email)
      : user.email
        ? this.normalizeEmail(user.email)
        : null;

    if (!targetEmail) {
      throw new BadRequestException({
        code: ResultCode.BAD_REQUEST,
        message: this.i18n.t('auth.email_required_for_set_password'),
      });
    }

    // Verify the email code (scene: 'set-password')
    await this.verificationCodeService.verify(
      targetEmail,
      dto.code,
      'set-password',
    );

    // If the user didn't have an email before, bind and verify the new one
    if (!user.email) {
      const existingUser = await this.userService.findByEmail(targetEmail);
      if (existingUser && existingUser.id !== userId) {
        throw new ConflictException({
          code: ResultCode.CONFLICT,
          message: this.i18n.t('auth.email_in_use'),
        });
      }
      await this.userService.update(userId, {
        email: targetEmail,
        emailVerifiedAt: new Date(),
      });
    }

    // Hash and save password
    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
    await this.userService.update(userId, { passwordHash });

    // Invalidate all sessions (security best practice after setting credential)
    await this.logoutAll(userId);
  }

  async changeEmail(userId: string, dto: ChangeEmailDto): Promise<User> {
    await this.getActiveUser(userId);
    const newEmail = this.normalizeEmail(dto.newEmail);

    const exists = await this.userService.findByEmail(newEmail);
    if (exists) {
      throw new ConflictException({
        code: ResultCode.CONFLICT,
        message: this.i18n.t('auth.email_in_use'),
      });
    }

    // 校验发往新邮箱的验证码，确认新邮箱归属。
    await this.verificationCodeService.verify(
      newEmail,
      dto.code,
      'change-email',
    );

    return this.userService.update(userId, {
      email: newEmail,
      emailVerifiedAt: new Date(),
    });
  }

  async deleteAccount(userId: string, dto: DeleteAccountDto): Promise<void> {
    const user = await this.getActiveUser(userId);

    if (dto.password) {
      // Password-based verification
      if (!user.passwordHash) {
        throw new UnauthorizedException({
          code: ResultCode.WRONG_PASSWORD,
          message: this.i18n.t('auth.use_code_for_oauth_account_deletion'),
        });
      }
      const valid = await argon2.verify(user.passwordHash, dto.password);
      if (!valid) {
        throw new UnauthorizedException({
          code: ResultCode.WRONG_PASSWORD,
          message: this.i18n.t('auth.password_wrong'),
        });
      }
    } else if (dto.code) {
      // Email-code-based verification (OAuth-only users)
      const email = user.email ? this.normalizeEmail(user.email) : null;
      if (!email) {
        throw new BadRequestException({
          code: ResultCode.BAD_REQUEST,
          message: this.i18n.t('auth.email_required_for_delete_account'),
        });
      }
      await this.verificationCodeService.verify(
        email,
        dto.code,
        'delete-account',
      );
    } else {
      throw new BadRequestException({
        code: ResultCode.BAD_REQUEST,
        message: this.i18n.t('auth.provide_password_or_code_for_deletion'),
      });
    }

    // Revoke all tokens then soft-delete
    await this.logoutAll(userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(), status: UserStatus.deleted },
    });
  }

  // ── Email Verification & Password Reset ──────────────────────

  async sendVerificationCode(
    dto: SendVerificationCodeDto,
    clientKey?: string,
  ): Promise<{ message: string }> {
    await this.verificationCodeService.send(
      this.normalizeEmail(dto.email),
      dto.scene,
      clientKey,
    );
    return { message: this.i18n.t('auth.verification_code_sent') };
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<void> {
    const email = this.normalizeEmail(dto.email);
    await this.verificationCodeService.verify(email, dto.code, 'register');
    await this.userService.updateByEmail(email, {
      emailVerifiedAt: new Date(),
    });
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
    clientKey?: string,
  ): Promise<{ message: string }> {
    // 安全策略：无论邮箱是否存在，都返回成功提示（防止邮箱枚举攻击）
    await this.verificationCodeService.assertClientRateLimit(clientKey);
    const email = this.normalizeEmail(dto.email);
    const user = await this.userService.findByEmail(email);
    if (user) {
      await this.verificationCodeService.send(email, 'reset-password');
    }
    return { message: this.i18n.t('auth.forgot_password_hint') };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const email = this.normalizeEmail(dto.email);
    await this.verificationCodeService.verify(
      email,
      dto.code,
      'reset-password',
    );
    const user = await this.userService.findByEmail(email);
    if (!user) {
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: this.i18n.t('auth.user_not_found'),
      });
    }
    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    // 重置密码后登出所有设备
    await this.logoutAll(user.id);
  }

  // ── OAuth ────────────────────────────────────────────────────

  async createWechatWebAuthorizeUrl(
    dto?: OAuthAuthorizeDto,
  ): Promise<OAuthAuthorizeResult> {
    return this.createWechatWebAuthorizeUrlForPurpose('login', dto);
  }

  async createWechatWebIdentityLinkAuthorizeUrl(
    dto?: OAuthAuthorizeDto,
  ): Promise<OAuthAuthorizeResult> {
    return this.createWechatWebAuthorizeUrlForPurpose('link', dto);
  }

  private async createWechatWebAuthorizeUrlForPurpose(
    purpose: OAuthStateEntry['purpose'],
    dto?: OAuthAuthorizeDto,
  ): Promise<OAuthAuthorizeResult> {
    const { state, ttlSec } = await this.authOAuthStateService.createState(
      purpose,
      dto?.callbackUri,
    );
    const entry = await this.authOAuthStateService.peek(state);

    return {
      authorizeUrl: this.wechatWebOAuthProvider.buildAuthorizeUrl(state),
      state,
      expiresIn: ttlSec,
      ...(entry.callbackUri !== undefined && {
        callbackUri: entry.callbackUri,
      }),
    };
  }

  async resolveWechatWebCallbackRedirect(
    dto: OAuthCallbackDto,
  ): Promise<string> {
    const entry = await this.authOAuthStateService.peek(dto.state);
    return this.authOAuthStateService.buildRedirectUrl(
      entry,
      dto.code,
      dto.state,
    );
  }

  async loginWithWechatWeb(
    dto: OAuthCallbackDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    await this.authOAuthStateService.consume(dto.state, 'login');
    const profile = await this.wechatWebOAuthProvider.fetchProfile(dto.code);
    return this.loginWithOAuthProfile(profile, context);
  }

  async loginWithWechatMobile(
    dto: OAuthCodeCallbackDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    const profile = await this.wechatMobileOAuthProvider.fetchProfile(dto.code);
    return this.loginWithOAuthProfile(profile, context);
  }

  async linkWechatWebIdentity(
    userId: string,
    dto: OAuthCallbackDto,
  ): Promise<void> {
    await this.getActiveUser(userId);
    await this.authOAuthStateService.consume(dto.state, 'link');
    const profile = await this.wechatWebOAuthProvider.fetchProfile(dto.code);
    await this.authOAuthService.linkOAuthProfileToUser(userId, profile);
  }

  async linkWechatMobileIdentity(
    userId: string,
    dto: OAuthCodeCallbackDto,
  ): Promise<void> {
    await this.getActiveUser(userId);
    const profile = await this.wechatMobileOAuthProvider.fetchProfile(dto.code);
    await this.authOAuthService.linkOAuthProfileToUser(userId, profile);
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private async loginWithOAuthProfile(
    profile: OAuthProfile,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    const user = await this.authOAuthService.findOrCreateOAuthUser(profile);
    const updatedUser = await this.authOAuthService.updateOAuthLoginUser(
      user,
      profile,
    );
    const tokens = await this.authTokenService.generateTokenPair(
      updatedUser,
      context,
    );
    // TODO(auth-audit): emit security notifications for new OAuth logins and newly linked identities.
    // blocked: requires email/notification delivery infrastructure and user-facing notification preference model.
    return { user: updatedUser, ...tokens };
  }
}
