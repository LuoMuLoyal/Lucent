import { Injectable, Logger } from '@nestjs/common';

import { User, UserStatus } from '#generated/prisma/client.js';
import { UserService } from '../../../user/index.js';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  mapUnknownToDependencyFailure,
  mapUnknownToInternalFailure,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
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
} from '../../dto/shared/oauth.dto.js';
import { GoogleOAuthProvider } from '../../providers/google-oauth.provider.js';
import { QqOAuthProvider } from '../../providers/qq-oauth.provider.js';
import { WeiboOAuthProvider } from '../../providers/weibo-oauth.provider.js';
import { WechatMobileOAuthProvider } from '../../providers/wechat/wechat-mobile-oauth.provider.js';
import { WechatWebOAuthProvider } from '../../providers/wechat/wechat-web-oauth.provider.js';
import {
  OAUTH_PROVIDER_GOOGLE,
  OAUTH_PROVIDER_QQ,
  OAUTH_PROVIDER_WECHAT_WEB,
  OAUTH_PROVIDER_WEIBO,
  type OAuthAuthorizeResult,
  type OAuthProfile,
} from '../../types/oauth.types.js';
import { AuthNotificationService } from '../notification.service.js';
import { AuthOAuthService } from './oauth.service.js';
import {
  AuthOAuthStateService,
  type OAuthStateEntry,
} from './state.service.js';
import { AuthTokenService, type TokenPair } from '../token.service.js';
import { AuthBetterAuthAdapter } from '../../adapters/better-auth.adapter.js';
import type { AuthRequestContext } from '../../types/auth-request.js';

@Injectable()
export class AuthOAuthFacadeService {
  private readonly logger = new Logger(AuthOAuthFacadeService.name);

  constructor(
    private readonly userService: UserService,
    private readonly wechatWebOAuthProvider: WechatWebOAuthProvider,
    private readonly wechatMobileOAuthProvider: WechatMobileOAuthProvider,
    private readonly qqOAuthProvider: QqOAuthProvider,
    private readonly weiboOAuthProvider: WeiboOAuthProvider,
    private readonly googleOAuthProvider: GoogleOAuthProvider,
    private readonly authOAuthStateService: AuthOAuthStateService,
    private readonly authTokenService: AuthTokenService,
    private readonly authOAuthService: AuthOAuthService,
    private readonly authNotificationService: AuthNotificationService,
    private readonly betterAuthAdapter: AuthBetterAuthAdapter,
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
    const idTokenName = (() => {
      if (!dto.givenName && !dto.familyName) {
        return undefined;
      }
      const name: { firstName?: string; lastName?: string } = {};
      if (dto.givenName) {
        name.firstName = dto.givenName;
      }
      if (dto.familyName) {
        name.lastName = dto.familyName;
      }
      return { name };
    })();

    const idToken = {
      token: dto.identityToken,
      ...(dto.authorizationCode && {
        accessToken: dto.authorizationCode,
      }),
      ...(idTokenName && { user: idTokenName }),
    };

    return fromPromise<{ user: { id: string } }, DomainFailure>(
      this.betterAuthAdapter.auth.api.signInSocial({
        body: { provider: 'apple', idToken },
      }) as Promise<{ user: { id: string } }>,
      (error) => this.mapBetterAuthOAuthError(error),
    )
      .andThen((result) => this.lift(this.userService.findById(result.user.id)))
      .andThen((user) => {
        if (!user) {
          return errAsync(
            createDomainFailure({
              kind: 'authentication',
              code: 'AUTH_OAUTH_FAILED',
              detail: 'Better Auth returned a user that does not exist locally',
            }),
          );
        }
        return this.finalizeSocialLogin(user, context);
      });
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
      .andThen(() => this.googleOAuthProvider.exchangeCodeForTokens(dto.code))
      .andThen(({ accessToken, idToken }) =>
        fromPromise<{ user: { id: string } }, DomainFailure>(
          this.betterAuthAdapter.auth.api.signInSocial({
            body: {
              provider: 'google',
              idToken: { token: idToken, accessToken },
            },
          }) as Promise<{ user: { id: string } }>,
          (error) => this.mapBetterAuthOAuthError(error),
        ),
      )
      .andThen((result) => this.lift(this.userService.findById(result.user.id)))
      .andThen((user) => {
        if (!user) {
          return errAsync(
            createDomainFailure({
              kind: 'authentication',
              code: 'AUTH_OAUTH_FAILED',
              detail: 'Better Auth returned a user that does not exist locally',
            }),
          );
        }
        return this.finalizeSocialLogin(user, context);
      });
  }

  linkWechatWebIdentity(
    userId: string,
    dto: OAuthCallbackDto,
  ): ResultAsync<void, DomainFailure> {
    return fromPromise(this.userService.findById(userId), (error) =>
      mapUnknownToDependencyFailure(
        error,
        'Failed to load user for identity link',
      ),
    )
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
    return fromPromise(this.userService.findById(userId), (error) =>
      mapUnknownToDependencyFailure(
        error,
        'Failed to load user for identity link',
      ),
    )
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

  private finalizeSocialLogin(
    user: User,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.userService
      .update(user.id, {
        lastLoginAt: new Date(),
        status: UserStatus.active,
      })
      .andThen((updatedUser) =>
        this.authTokenService
          .generateTokenPair(updatedUser, context)
          .andThen((tokens) =>
            this.betterAuthAdapter
              .revokeBetterAuthSessions(updatedUser.id)
              .map(() => ({ user: updatedUser, ...tokens })),
          ),
      );
  }

  private mapBetterAuthOAuthError(error: unknown): DomainFailure {
    const isBetterAuthAPIError = (
      e: unknown,
    ): e is {
      statusCode: number;
      body?: { code?: string; message?: string };
    } =>
      typeof e === 'object' &&
      e !== null &&
      'statusCode' in e &&
      typeof (e as Record<string, unknown>)['statusCode'] === 'number';

    if (isBetterAuthAPIError(error)) {
      const code = error.body?.code;
      switch (code) {
        case 'USER_ALREADY_EXISTS':
        case 'IDENTITY_ALREADY_LINKED':
          return createDomainFailure({
            kind: 'conflict',
            code: 'RESOURCE_CONFLICT',
          });
        case 'INVALID_TOKEN':
        case 'OAUTH_ACCOUNT_NOT_LINKED':
        case 'INVALID_OAUTH_RESPONSE':
        case 'EMAIL_NOT_VERIFIED':
        case 'OAUTH_PROVIDER_ERROR':
        case 'SOCIAL_PROVIDER_ERROR':
        case 'INVALID_OAUTH_STATE':
        case 'OAUTH_ACCESS_DENIED':
          return createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_OAUTH_FAILED',
          });
        // Configuration/disabled errors: the OAuth method is unavailable.
        case 'SOCIAL_SIGN_IN_DISABLED':
        case 'PROVIDER_NOT_FOUND':
          return createDomainFailure({
            kind: 'dependency',
            code: 'AUTH_METHOD_DISABLED',
          });
        default:
          // Any other Better Auth API error is treated as an OAuth failure
          // rather than leaking as a raw 500.  Better Auth 5xx responses are
          // considered dependency failures.
          if (error.statusCode >= 500) {
            return createDomainFailure({
              kind: 'dependency',
              code: 'DEPENDENCY_UNAVAILABLE',
            });
          }
          return createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_OAUTH_FAILED',
          });
      }
    }

    return mapUnknownToInternalFailure(error, 'Unexpected OAuth error');
  }

  /**
   * Lifts a plain Promise into a ResultAsync.  Unexpected errors are mapped to
   * `DEPENDENCY_UNAVAILABLE` so they stay inside the Result channel instead of
   * becoming unhandled rejections.
   */
  private lift<T>(promise: Promise<T>): ResultAsync<T, DomainFailure> {
    return fromPromise(promise, (error) =>
      mapUnknownToDependencyFailure(error, 'OAuth user lookup failed'),
    );
  }
}
