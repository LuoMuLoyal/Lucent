import { Injectable, Logger } from '@nestjs/common';

import { User } from '#generated/prisma/client';
import { UserService } from '../../../user';
import {
  fromPromise,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result';
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
} from '../../dto/shared/oauth.dto';
import { AppleOAuthProvider } from '../../providers/apple-oauth.provider';
import { GoogleOAuthProvider } from '../../providers/google-oauth.provider';
import { QqOAuthProvider } from '../../providers/qq-oauth.provider';
import { WeiboOAuthProvider } from '../../providers/weibo-oauth.provider';
import { WechatMobileOAuthProvider } from '../../providers/wechat/wechat-mobile-oauth.provider';
import { WechatWebOAuthProvider } from '../../providers/wechat/wechat-web-oauth.provider';
import {
  OAUTH_PROVIDER_GOOGLE,
  OAUTH_PROVIDER_QQ,
  OAUTH_PROVIDER_WECHAT_WEB,
  OAUTH_PROVIDER_WEIBO,
  type OAuthAuthorizeResult,
  type OAuthProfile,
} from '../../types/oauth.types';
import { AuthNotificationService } from '../notification.service';
import { AuthOAuthService } from './oauth.service';
import { AuthOAuthStateService, type OAuthStateEntry } from './state.service';
import { AuthTokenService, type TokenPair } from '../token.service';
import type { AuthRequestContext } from '../../types/auth-request';

@Injectable()
export class AuthOAuthFacadeService {
  private readonly logger = new Logger(AuthOAuthFacadeService.name);

  constructor(
    private readonly userService: UserService,
    private readonly wechatWebOAuthProvider: WechatWebOAuthProvider,
    private readonly wechatMobileOAuthProvider: WechatMobileOAuthProvider,
    private readonly appleOAuthProvider: AppleOAuthProvider,
    private readonly qqOAuthProvider: QqOAuthProvider,
    private readonly weiboOAuthProvider: WeiboOAuthProvider,
    private readonly googleOAuthProvider: GoogleOAuthProvider,
    private readonly authOAuthStateService: AuthOAuthStateService,
    private readonly authTokenService: AuthTokenService,
    private readonly authOAuthService: AuthOAuthService,
    private readonly authNotificationService: AuthNotificationService,
  ) {}

  createWechatWebAuthorizeUrl(
    dto?: OAuthAuthorizeDto,
  ): ResultAsync<OAuthAuthorizeResult, DomainFailure> {
    return this.createWechatWebAuthorizeUrlForPurpose('login', dto);
  }

  createWechatWebIdentityLinkAuthorizeUrl(
    dto?: OAuthAuthorizeDto,
  ): ResultAsync<OAuthAuthorizeResult, DomainFailure> {
    return this.createWechatWebAuthorizeUrlForPurpose('link', dto);
  }

  private createWechatWebAuthorizeUrlForPurpose(
    purpose: OAuthStateEntry['purpose'],
    dto?: OAuthAuthorizeDto,
  ): ResultAsync<OAuthAuthorizeResult, DomainFailure> {
    return this.authOAuthStateService
      .createState(OAUTH_PROVIDER_WECHAT_WEB, purpose, dto?.callbackUri)
      .andThen(({ state, ttlSec }) =>
        this.authOAuthStateService
          .peek(OAUTH_PROVIDER_WECHAT_WEB, state)
          .map((entry) => ({
            authorizeUrl: this.wechatWebOAuthProvider.buildAuthorizeUrl(state),
            state,
            expiresIn: ttlSec,
            ...(entry.callbackUri !== undefined && {
              callbackUri: entry.callbackUri,
            }),
          })),
      );
  }

  resolveWechatWebCallbackRedirect(
    dto: OAuthCallbackDto,
  ): ResultAsync<string, DomainFailure> {
    return this.authOAuthStateService
      .peek(OAUTH_PROVIDER_WECHAT_WEB, dto.state)
      .andThen((entry) =>
        this.authOAuthStateService.buildRedirectUrl(entry, dto.code, dto.state),
      );
  }

  loginWithWechatWeb(
    dto: OAuthCallbackDto,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.authOAuthStateService
      .consume(OAUTH_PROVIDER_WECHAT_WEB, dto.state, 'login')
      .andThen(() =>
        this.wechatWebOAuthProvider.fetchProfile({ code: dto.code }),
      )
      .andThen((profile) => this.loginWithOAuthProfile(profile, context));
  }

  loginWithWechatMobile(
    dto: OAuthCodeCallbackDto,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.wechatMobileOAuthProvider
      .fetchProfile({ code: dto.code })
      .andThen((profile) => this.loginWithOAuthProfile(profile, context));
  }

  loginWithApple(
    dto: AppleOAuthCallbackDto,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.appleOAuthProvider
      .fetchProfile({
        identityToken: dto.identityToken,
        authorizationCode: dto.authorizationCode,
        givenName: dto.givenName,
        familyName: dto.familyName,
      })
      .andThen((profile) => this.loginWithOAuthProfile(profile, context));
  }

  createQqAuthorizeUrl(
    dto?: QqOAuthAuthorizeDto,
  ): ResultAsync<OAuthAuthorizeResult, DomainFailure> {
    return this.authOAuthStateService
      .createState(OAUTH_PROVIDER_QQ, 'login', dto?.callbackUri)
      .andThen(({ state, ttlSec }) =>
        this.authOAuthStateService
          .peek(OAUTH_PROVIDER_QQ, state)
          .map((entry) => ({
            authorizeUrl: this.qqOAuthProvider.buildAuthorizeUrl(
              state,
              dto?.callbackUri,
            ),
            state,
            expiresIn: ttlSec,
            ...(entry.callbackUri !== undefined && {
              callbackUri: entry.callbackUri,
            }),
          })),
      );
  }

  loginWithQq(
    dto: QqOAuthCallbackDto,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.authOAuthStateService
      .consume(OAUTH_PROVIDER_QQ, dto.state, 'login')
      .andThen(() => this.qqOAuthProvider.fetchProfile({ code: dto.code }))
      .andThen((profile) => this.loginWithOAuthProfile(profile, context));
  }

  createWeiboAuthorizeUrl(
    dto?: WeiboOAuthAuthorizeDto,
  ): ResultAsync<OAuthAuthorizeResult, DomainFailure> {
    return this.authOAuthStateService
      .createState(OAUTH_PROVIDER_WEIBO, 'login', dto?.callbackUri)
      .andThen(({ state, ttlSec }) =>
        this.authOAuthStateService
          .peek(OAUTH_PROVIDER_WEIBO, state)
          .map((entry) => ({
            authorizeUrl: this.weiboOAuthProvider.buildAuthorizeUrl(
              state,
              dto?.callbackUri,
            ),
            state,
            expiresIn: ttlSec,
            ...(entry.callbackUri !== undefined && {
              callbackUri: entry.callbackUri,
            }),
          })),
      );
  }

  loginWithWeibo(
    dto: WeiboOAuthCallbackDto,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.authOAuthStateService
      .consume(OAUTH_PROVIDER_WEIBO, dto.state, 'login')
      .andThen(() => this.weiboOAuthProvider.fetchProfile({ code: dto.code }))
      .andThen((profile) => this.loginWithOAuthProfile(profile, context));
  }

  createGoogleAuthorizeUrl(
    dto?: GoogleOAuthAuthorizeDto,
  ): ResultAsync<OAuthAuthorizeResult, DomainFailure> {
    return this.authOAuthStateService
      .createState(OAUTH_PROVIDER_GOOGLE, 'login', dto?.callbackUri)
      .andThen(({ state, ttlSec }) =>
        this.authOAuthStateService
          .peek(OAUTH_PROVIDER_GOOGLE, state)
          .map((entry) => ({
            authorizeUrl: this.googleOAuthProvider.buildAuthorizeUrl(
              state,
              dto?.callbackUri,
            ),
            state,
            expiresIn: ttlSec,
            ...(entry.callbackUri !== undefined && {
              callbackUri: entry.callbackUri,
            }),
          })),
      );
  }

  loginWithGoogle(
    dto: GoogleOAuthCallbackDto,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.authOAuthStateService
      .consume(OAUTH_PROVIDER_GOOGLE, dto.state, 'login')
      .andThen(() => this.googleOAuthProvider.fetchProfile({ code: dto.code }))
      .andThen((profile) => this.loginWithOAuthProfile(profile, context));
  }

  linkWechatWebIdentity(
    userId: string,
    dto: OAuthCallbackDto,
  ): ResultAsync<void, DomainFailure> {
    return fromPromise(this.userService.findById(userId), (error) => {
      throw error;
    })
      .andThen(() =>
        this.authOAuthStateService.consume(
          OAUTH_PROVIDER_WECHAT_WEB,
          dto.state,
          'link',
        ),
      )
      .andThen(() =>
        this.wechatWebOAuthProvider.fetchProfile({ code: dto.code }),
      )
      .andThen((profile) =>
        this.authOAuthService
          .linkOAuthProfileToUser(userId, profile)
          .map(() => {
            this.authNotificationService
              .notifyIdentityLinked(userId, profile)
              .catch((error: unknown) => {
                this.logger.error(
                  `Failed to send identity-linked notification for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
                  error instanceof Error ? error.stack : undefined,
                );
              });
          }),
      );
  }

  linkWechatMobileIdentity(
    userId: string,
    dto: OAuthCodeCallbackDto,
  ): ResultAsync<void, DomainFailure> {
    return fromPromise(this.userService.findById(userId), (error) => {
      throw error;
    })
      .andThen(() =>
        this.wechatMobileOAuthProvider.fetchProfile({ code: dto.code }),
      )
      .andThen((profile) =>
        this.authOAuthService.linkOAuthProfileToUser(userId, profile),
      );
  }

  private loginWithOAuthProfile(
    profile: OAuthProfile,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.authOAuthService
      .findOrCreateOAuthUser(profile)
      .andThen((user) =>
        this.authOAuthService.updateOAuthLoginUser(user, profile),
      )
      .andThen((updatedUser) =>
        this.authTokenService
          .generateTokenPair(updatedUser, context)
          .map((tokens) => {
            this.authNotificationService
              .notifyOAuthLogin(updatedUser.id, profile)
              .catch((error: unknown) => {
                this.logger.error(
                  `Failed to send oauth-login notification for user ${updatedUser.id}: ${error instanceof Error ? error.message : String(error)}`,
                  error instanceof Error ? error.stack : undefined,
                );
              });
            return { user: updatedUser, ...tokens };
          }),
      );
  }
}
