import { Injectable, UnauthorizedException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import * as argon2 from 'argon2';

import { badRequest, notFound } from '../../common/utils/api-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { User, UserStatus } from '../../generated/prisma/client';
import { UserService } from '../user/user.service';
import { VerificationCodeService } from './services/verification-code.service';
import { ResultCode } from '../../common/api-envelope';
import { DeleteAccountDto } from './dto/delete-account.dto';
import {
  OAuthAuthorizeDto,
  OAuthCallbackDto,
  OAuthCodeCallbackDto,
  AppleOAuthCallbackDto,
  QqOAuthCallbackDto,
  QqOAuthAuthorizeDto,
} from './dto/oauth.dto';
import { WechatWebOAuthProvider } from './providers/wechat-web-oauth.provider';
import { WechatMobileOAuthProvider } from './providers/wechat-mobile-oauth.provider';
import { AppleOAuthProvider } from './providers/apple-oauth.provider';
import { QqOAuthProvider } from './providers/qq-oauth.provider';
import {
  OAUTH_PROVIDER_WECHAT_WEB,
  OAUTH_PROVIDER_QQ,
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
import { AuthOAuthService } from './services/auth-oauth.service';
import {
  CredentialAuthService,
  normalizeEmail,
} from './services/credential-auth.service';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/login.dto';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { ChangeEmailDto } from './dto/change-email.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import type { SetPasswordDto } from './dto/set-password.dto';
import type { ForgotPasswordDto } from './dto/forgot-password.dto';
import type { SendVerificationCodeDto } from './dto/send-verification-code.dto';
import type { VerifyEmailDto } from './dto/verify-email.dto';

export type {
  AuthRequestContext,
  UserPayload,
} from './services/auth-token.service';

/**
 * Central authentication facade that orchestrates credential flows
 * (via {@link CredentialAuthService}) and OAuth flows (via dedicated sub-services).
 *
 * Controller-facing methods delegate to the appropriate domain service.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly verificationCodeService: VerificationCodeService,
    private readonly wechatWebOAuthProvider: WechatWebOAuthProvider,
    private readonly wechatMobileOAuthProvider: WechatMobileOAuthProvider,
    private readonly appleOAuthProvider: AppleOAuthProvider,
    private readonly qqOAuthProvider: QqOAuthProvider,
    private readonly i18n: I18nService,
    private readonly authTokenService: AuthTokenService,
    private readonly authOAuthStateService: AuthOAuthStateService,
    private readonly authOAuthService: AuthOAuthService,
    private readonly credentialAuthService: CredentialAuthService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Credential delegation ────────────────────────────────────

  async register(dto: RegisterDto, context?: AuthRequestContext) {
    return this.credentialAuthService.register(dto, context);
  }

  async login(dto: LoginDto, context?: AuthRequestContext) {
    return this.credentialAuthService.login(dto, context);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    return this.credentialAuthService.changePassword(userId, dto);
  }

  async setPassword(userId: string, dto: SetPasswordDto) {
    return this.credentialAuthService.setPassword(userId, dto);
  }

  async changeEmail(userId: string, dto: ChangeEmailDto) {
    return this.credentialAuthService.changeEmail(userId, dto);
  }

  async sendVerificationCode(dto: SendVerificationCodeDto, clientKey?: string) {
    return this.credentialAuthService.sendVerificationCode(dto, clientKey);
  }

  async verifyEmail(dto: VerifyEmailDto) {
    return this.credentialAuthService.verifyEmail(dto);
  }

  async forgotPassword(dto: ForgotPasswordDto, clientKey?: string) {
    return this.credentialAuthService.forgotPassword(dto, clientKey);
  }

  async resetPassword(dto: ResetPasswordDto) {
    return this.credentialAuthService.resetPassword(dto);
  }

  // ── Token Management ─────────────────────────────────────────

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

  async logout(userId: string, refreshToken: string): Promise<void> {
    await this.authTokenService.revoke(userId, refreshToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.authTokenService.revokeAll(userId);
  }

  // ── Profile Management ───────────────────────────────────────

  async getActiveUser(userId: string): Promise<User> {
    const user = await this.userService.findById(userId);
    if (!user) {
      notFound(this.i18n.t('auth.user_not_found'));
    }
    return user;
  }

  async deleteAccount(userId: string, dto: DeleteAccountDto): Promise<void> {
    const user = await this.getActiveUser(userId);

    if (dto.password) {
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
      const email = user.email ? normalizeEmail(user.email) : null;
      if (!email) {
        badRequest(this.i18n.t('auth.email_required_for_delete_account'));
      }
      await this.verificationCodeService.verify(
        email,
        dto.code,
        'delete-account',
      );
    } else {
      badRequest(this.i18n.t('auth.provide_password_or_code_for_deletion'));
    }

    await this.logoutAll(userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(), status: UserStatus.deleted },
    });
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
      OAUTH_PROVIDER_WECHAT_WEB,
      purpose,
      dto?.callbackUri,
    );
    const entry = await this.authOAuthStateService.peek(
      OAUTH_PROVIDER_WECHAT_WEB,
      state,
    );

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
    const entry = await this.authOAuthStateService.peek(
      OAUTH_PROVIDER_WECHAT_WEB,
      dto.state,
    );
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
    await this.authOAuthStateService.consume(
      OAUTH_PROVIDER_WECHAT_WEB,
      dto.state,
      'login',
    );
    const profile = await this.wechatWebOAuthProvider.fetchProfile({
      code: dto.code,
    });
    return this.loginWithOAuthProfile(profile, context);
  }

  async loginWithWechatMobile(
    dto: OAuthCodeCallbackDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    const profile = await this.wechatMobileOAuthProvider.fetchProfile({
      code: dto.code,
    });
    return this.loginWithOAuthProfile(profile, context);
  }

  async loginWithApple(
    dto: AppleOAuthCallbackDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    const profile = await this.appleOAuthProvider.fetchProfile({
      identityToken: dto.identityToken,
      authorizationCode: dto.authorizationCode,
      givenName: dto.givenName,
      familyName: dto.familyName,
    });
    return this.loginWithOAuthProfile(profile, context);
  }

  async createQqAuthorizeUrl(
    dto?: QqOAuthAuthorizeDto,
  ): Promise<OAuthAuthorizeResult> {
    const { state, ttlSec } = await this.authOAuthStateService.createState(
      OAUTH_PROVIDER_QQ,
      'login',
      dto?.callbackUri,
    );
    const entry = await this.authOAuthStateService.peek(
      OAUTH_PROVIDER_QQ,
      state,
    );

    return {
      authorizeUrl: this.qqOAuthProvider.buildAuthorizeUrl(
        state,
        dto?.callbackUri,
      ),
      state,
      expiresIn: ttlSec,
      ...(entry.callbackUri !== undefined && {
        callbackUri: entry.callbackUri,
      }),
    };
  }

  async loginWithQq(
    dto: QqOAuthCallbackDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    await this.authOAuthStateService.consume(
      OAUTH_PROVIDER_QQ,
      dto.state,
      'login',
    );
    const profile = await this.qqOAuthProvider.fetchProfile({ code: dto.code });
    return this.loginWithOAuthProfile(profile, context);
  }

  async linkWechatWebIdentity(
    userId: string,
    dto: OAuthCallbackDto,
  ): Promise<void> {
    await this.getActiveUser(userId);
    await this.authOAuthStateService.consume(
      OAUTH_PROVIDER_WECHAT_WEB,
      dto.state,
      'link',
    );
    const profile = await this.wechatWebOAuthProvider.fetchProfile({
      code: dto.code,
    });
    await this.authOAuthService.linkOAuthProfileToUser(userId, profile);
    this._notifyIdentityLinked(userId, profile).catch(() => {});
  }

  async linkWechatMobileIdentity(
    userId: string,
    dto: OAuthCodeCallbackDto,
  ): Promise<void> {
    await this.getActiveUser(userId);
    const profile = await this.wechatMobileOAuthProvider.fetchProfile({
      code: dto.code,
    });
    await this.authOAuthService.linkOAuthProfileToUser(userId, profile);
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
    // Emit security notification for new OAuth login
    this._notifyOAuthLogin(updatedUser.id, profile).catch(() => {
      // Silently fail — notification issues must not block auth flow.
    });
    return { user: updatedUser, ...tokens };
  }

  private async _notifyOAuthLogin(
    userId: string,
    profile: OAuthProfile,
  ): Promise<void> {
    await this.notificationsService.create(userId, {
      type: 'password_changed',
      title: '账户登录提醒',
      content: `您的账户通过${this._providerLabel(profile.provider)}登录。如非本人操作，请尽快联系客服。`,
      action: '/account',
    });
  }

  private async _notifyIdentityLinked(
    userId: string,
    profile: OAuthProfile,
  ): Promise<void> {
    await this.notificationsService.create(userId, {
      type: 'password_changed',
      title: '账户绑定提醒',
      content: `您的账户已绑定${this._providerLabel(profile.provider)}身份。如非本人操作，请尽快联系客服。`,
      action: '/account',
    });
  }

  private _providerLabel(provider: string): string {
    const labels: Record<string, string> = {
      wechat_web: '微信',
      wechat_mobile: '微信',
      apple: 'Apple',
      qq: 'QQ',
    };
    return labels[provider] ?? provider;
  }

  // ── 2FA delegation ────────────────────────────────────────────

  async setupTwoFactor(userId: string) {
    return this.credentialAuthService.setupTwoFactor(userId);
  }

  async confirmTwoFactor(userId: string, code: string) {
    return this.credentialAuthService.confirmTwoFactor(userId, code);
  }

  async verifyTwoFactor(dto: { code: string; tempToken: string }) {
    return this.credentialAuthService.verifyTwoFactor(dto.tempToken, dto.code);
  }

  async disableTwoFactor(userId: string) {
    return this.credentialAuthService.disableTwoFactor(userId);
  }
}
