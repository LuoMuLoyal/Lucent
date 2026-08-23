import { Injectable } from '@nestjs/common';

import { User } from '#generated/prisma/client';
import type { DomainFailure, ResultAsync } from '../../../common/result';
import { DeleteAccountDto } from '../dto/shared/delete-account.dto';
import { ChangeEmailDto } from '../dto/password/change-email.dto';
import { ChangePasswordDto } from '../dto/password/change-password.dto';
import { ForgotPasswordDto } from '../dto/password/forgot-password.dto';
import { LoginDto } from '../dto/credentials/login.dto';
import {
  AppleOAuthCallbackDto,
  GoogleOAuthAuthorizeDto,
  GoogleOAuthCallbackDto,
  OAuthAuthorizeDto,
  OAuthCallbackDto,
  OAuthCodeCallbackDto,
  QqOAuthAuthorizeDto,
  QqOAuthCallbackDto,
  WeiboOAuthAuthorizeDto,
  WeiboOAuthCallbackDto,
} from '../dto/shared/oauth.dto';
import { RegisterDto } from '../dto/credentials/register.dto';
import { ResetPasswordDto } from '../dto/password/reset-password.dto';
import { SendVerificationCodeDto } from '../dto/password/send-verification-code.dto';
import { SetPasswordDto } from '../dto/password/set-password.dto';
import { VerifyEmailDto } from '../dto/password/verify-email.dto';
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
  constructor(
    private readonly authTokenService: AuthTokenService,
    private readonly credentialAuthService: CredentialAuthService,
    private readonly authAccountService: AuthAccountService,
    private readonly authOAuthFacadeService: AuthOAuthFacadeService,
  ) {}

  // ── Credential delegation ────────────────────────────────────

  register(
    dto: RegisterDto,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.credentialAuthService.register(dto, context);
  }

  login(
    dto: LoginDto,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.credentialAuthService.login(dto, context);
  }

  changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): ResultAsync<void, DomainFailure> {
    return this.credentialAuthService.changePassword(userId, dto);
  }

  setPassword(
    userId: string,
    dto: SetPasswordDto,
  ): ResultAsync<void, DomainFailure> {
    return this.credentialAuthService.setPassword(userId, dto);
  }

  changeEmail(
    userId: string,
    dto: ChangeEmailDto,
  ): ResultAsync<User, DomainFailure> {
    return this.credentialAuthService.changeEmail(userId, dto);
  }

  sendVerificationCode(
    dto: SendVerificationCodeDto,
    clientKey?: string,
  ): ResultAsync<{ message: string }, DomainFailure> {
    return this.credentialAuthService.sendVerificationCode(dto, clientKey);
  }

  verifyEmail(dto: VerifyEmailDto): ResultAsync<void, DomainFailure> {
    return this.credentialAuthService.verifyEmail(dto);
  }

  forgotPassword(
    dto: ForgotPasswordDto,
    clientKey?: string,
  ): ResultAsync<{ message: string }, DomainFailure> {
    return this.credentialAuthService.forgotPassword(dto, clientKey);
  }

  resetPassword(dto: ResetPasswordDto): ResultAsync<void, DomainFailure> {
    return this.credentialAuthService.resetPassword(dto);
  }

  // ── Token Management ─────────────────────────────────────────

  /**
   * Rotates a refresh token. Only truly invalid, expired or already-consumed
   * refresh tokens map to `AUTH_REFRESH_TOKEN_INVALID` (signalled by the token
   * service / session repository as a DomainFailure). Database, signing and
   * configuration failures are re-thrown and keep their real exception
   * semantics — they are never misreported as an invalid token.
   */
  refresh(
    refreshToken: string,
    context?: AuthRequestContext,
  ): ResultAsync<TokenPair, DomainFailure> {
    return this.authTokenService.refresh(refreshToken, context);
  }

  logout(
    userId: string,
    refreshToken: string,
  ): ResultAsync<void, DomainFailure> {
    return this.authTokenService.revoke(userId, refreshToken);
  }

  logoutAll(userId: string): ResultAsync<void, DomainFailure> {
    return this.authTokenService.revokeAll(userId);
  }

  // ── Account Management ───────────────────────────────────────

  getActiveUser(userId: string): ResultAsync<User, DomainFailure> {
    return this.authAccountService.getActiveUser(userId);
  }

  deleteAccount(
    userId: string,
    dto: DeleteAccountDto,
  ): ResultAsync<void, DomainFailure> {
    return this.logoutAll(userId).andThen(() =>
      this.authAccountService.deleteAccount(userId, dto),
    );
  }

  // ── OAuth delegation ─────────────────────────────────────────

  createWechatWebAuthorizeUrl(
    dto?: OAuthAuthorizeDto,
  ): ResultAsync<OAuthAuthorizeResult, DomainFailure> {
    return this.authOAuthFacadeService.createWechatWebAuthorizeUrl(dto);
  }

  createWechatWebIdentityLinkAuthorizeUrl(
    dto?: OAuthAuthorizeDto,
  ): ResultAsync<OAuthAuthorizeResult, DomainFailure> {
    return this.authOAuthFacadeService.createWechatWebIdentityLinkAuthorizeUrl(
      dto,
    );
  }

  resolveWechatWebCallbackRedirect(
    dto: OAuthCallbackDto,
  ): ResultAsync<string, DomainFailure> {
    return this.authOAuthFacadeService.resolveWechatWebCallbackRedirect(dto);
  }

  loginWithWechatWeb(
    dto: OAuthCallbackDto,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.authOAuthFacadeService.loginWithWechatWeb(dto, context);
  }

  loginWithWechatMobile(
    dto: OAuthCodeCallbackDto,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.authOAuthFacadeService.loginWithWechatMobile(dto, context);
  }

  loginWithApple(
    dto: AppleOAuthCallbackDto,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.authOAuthFacadeService.loginWithApple(dto, context);
  }

  createQqAuthorizeUrl(
    dto?: QqOAuthAuthorizeDto,
  ): ResultAsync<OAuthAuthorizeResult, DomainFailure> {
    return this.authOAuthFacadeService.createQqAuthorizeUrl(dto);
  }

  loginWithQq(
    dto: QqOAuthCallbackDto,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.authOAuthFacadeService.loginWithQq(dto, context);
  }

  createWeiboAuthorizeUrl(
    dto?: WeiboOAuthAuthorizeDto,
  ): ResultAsync<OAuthAuthorizeResult, DomainFailure> {
    return this.authOAuthFacadeService.createWeiboAuthorizeUrl(dto);
  }

  loginWithWeibo(
    dto: WeiboOAuthCallbackDto,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.authOAuthFacadeService.loginWithWeibo(dto, context);
  }

  createGoogleAuthorizeUrl(
    dto?: GoogleOAuthAuthorizeDto,
  ): ResultAsync<OAuthAuthorizeResult, DomainFailure> {
    return this.authOAuthFacadeService.createGoogleAuthorizeUrl(dto);
  }

  loginWithGoogle(
    dto: GoogleOAuthCallbackDto,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.authOAuthFacadeService.loginWithGoogle(dto, context);
  }

  linkWechatWebIdentity(
    userId: string,
    dto: OAuthCallbackDto,
  ): ResultAsync<void, DomainFailure> {
    return this.authOAuthFacadeService.linkWechatWebIdentity(userId, dto);
  }

  linkWechatMobileIdentity(
    userId: string,
    dto: OAuthCodeCallbackDto,
  ): ResultAsync<void, DomainFailure> {
    return this.authOAuthFacadeService.linkWechatMobileIdentity(userId, dto);
  }
}
