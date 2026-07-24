import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { User } from '#generated/prisma/client';
import { ResultCode } from '../../../common';
import { DeleteAccountDto } from '../dto/delete-account.dto';
import { ChangeEmailDto } from '../dto/change-email.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { LoginDto } from '../dto/login.dto';
import {
  AppleOAuthCallbackDto,
  OAuthAuthorizeDto,
  OAuthCallbackDto,
  OAuthCodeCallbackDto,
  QqOAuthAuthorizeDto,
  QqOAuthCallbackDto,
} from '../dto/oauth.dto';
import { RegisterDto } from '../dto/register.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { SendVerificationCodeDto } from '../dto/send-verification-code.dto';
import { SetPasswordDto } from '../dto/set-password.dto';
import { VerifyEmailDto } from '../dto/verify-email.dto';
import { AuthRequestContext, TokenPair } from '../types/auth-request';
import { OAuthAuthorizeResult } from '../types/oauth.types';
import { AuthAccountService } from './account.service';
import { AuthOAuthFacadeService } from './oauth/facade.service';
import { AuthTokenService } from './token.service';
import { CredentialAuthService } from './identity/credential.service';

export type { AuthRequestContext, UserPayload } from '../types/auth-request';

/**
 * Central authentication facade that orchestrates credential flows,
 * token management, account lifecycle, and OAuth flows via focused
 * sub-services.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly i18n: I18nService,
    private readonly authTokenService: AuthTokenService,
    private readonly credentialAuthService: CredentialAuthService,
    private readonly authAccountService: AuthAccountService,
    private readonly authOAuthFacadeService: AuthOAuthFacadeService,
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
    } catch (error) {
      this.logger.warn('Token refresh failed', { error });
      throw new UnauthorizedException({
        code: ResultCode.REFRESH_TOKEN_INVALID,
        message: this.i18n.t('auth.refresh_token_invalid'),
        cause: error,
      });
    }
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    await this.authTokenService.revoke(userId, refreshToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.authTokenService.revokeAll(userId);
  }

  // ── Account Management ───────────────────────────────────────

  async getActiveUser(userId: string): Promise<User> {
    return this.authAccountService.getActiveUser(userId);
  }

  async deleteAccount(userId: string, dto: DeleteAccountDto): Promise<void> {
    await this.logoutAll(userId);
    await this.authAccountService.deleteAccount(userId, dto);
  }

  // ── OAuth delegation ─────────────────────────────────────────

  async createWechatWebAuthorizeUrl(
    dto?: OAuthAuthorizeDto,
  ): Promise<OAuthAuthorizeResult> {
    return this.authOAuthFacadeService.createWechatWebAuthorizeUrl(dto);
  }

  async createWechatWebIdentityLinkAuthorizeUrl(
    dto?: OAuthAuthorizeDto,
  ): Promise<OAuthAuthorizeResult> {
    return this.authOAuthFacadeService.createWechatWebIdentityLinkAuthorizeUrl(
      dto,
    );
  }

  async resolveWechatWebCallbackRedirect(
    dto: OAuthCallbackDto,
  ): Promise<string> {
    return this.authOAuthFacadeService.resolveWechatWebCallbackRedirect(dto);
  }

  async loginWithWechatWeb(
    dto: OAuthCallbackDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    return this.authOAuthFacadeService.loginWithWechatWeb(dto, context);
  }

  async loginWithWechatMobile(
    dto: OAuthCodeCallbackDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    return this.authOAuthFacadeService.loginWithWechatMobile(dto, context);
  }

  async loginWithApple(
    dto: AppleOAuthCallbackDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    return this.authOAuthFacadeService.loginWithApple(dto, context);
  }

  async createQqAuthorizeUrl(
    dto?: QqOAuthAuthorizeDto,
  ): Promise<OAuthAuthorizeResult> {
    return this.authOAuthFacadeService.createQqAuthorizeUrl(dto);
  }

  async loginWithQq(
    dto: QqOAuthCallbackDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    return this.authOAuthFacadeService.loginWithQq(dto, context);
  }

  async linkWechatWebIdentity(
    userId: string,
    dto: OAuthCallbackDto,
  ): Promise<void> {
    return this.authOAuthFacadeService.linkWechatWebIdentity(userId, dto);
  }

  async linkWechatMobileIdentity(
    userId: string,
    dto: OAuthCodeCallbackDto,
  ): Promise<void> {
    return this.authOAuthFacadeService.linkWechatMobileIdentity(userId, dto);
  }
}
