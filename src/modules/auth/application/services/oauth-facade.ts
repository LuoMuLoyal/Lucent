import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { User } from '#generated/prisma/client.js';
import { UserService } from '../../../user/index.js';
import {
  fromPromise,
  mapUnknownToDependencyFailure,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import type {
  AppleOAuthCallbackDto,
  GoogleOAuthAuthorizeDto,
  GoogleOAuthCallbackDto,
  OAuthAuthorizeDto,
  OAuthCallbackDto,
  OAuthCodeCallbackDto,
  QqOAuthAuthorizeDto,
  QqOAuthCallbackDto,
} from '../../dto/shared/oauth.dto.js';
import type { OAuthProvider } from '../ports/oauth-provider.js';
import {
  OAUTH_PROVIDER_GOOGLE,
  OAUTH_PROVIDER_QQ,
  OAUTH_PROVIDER_WECHAT_WEB,
  type OAuthAuthorizeResult,
} from '../../types/oauth.types.js';
import type { OAuthProviderProfile } from '../../application/ports/oauth-provider.js';
import { AuthNotificationService } from '../../services/notification.service.js';
import { AuthOAuthService } from '../../services/oauth/oauth.service.js';
import {
  AuthOAuthStateService,
  type OAuthStateEntry,
} from '../../services/oauth/state.service.js';
import {
  SessionTokens,
  type TokenPair,
} from '../../application/services/session-tokens.js';
import { toSessionSubject } from '../../application/services/session-subject.js';
import type { RequestOrigin } from '../../application/ports/request-origin.js';

@Injectable()
export class AuthOAuthFacadeService {
  private readonly logger = new Logger(AuthOAuthFacadeService.name);

  constructor(
    private readonly userService: UserService,
    private readonly wechatWebOAuthProvider: OAuthProvider,
    private readonly wechatMobileOAuthProvider: OAuthProvider,
    private readonly qqOAuthProvider: OAuthProvider,
    private readonly googleOAuthProvider: OAuthProvider,
    private readonly appleOAuthProvider: OAuthProvider,
    private readonly authOAuthStateService: AuthOAuthStateService,
    private readonly sessionTokens: SessionTokens,
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
            authorizeUrl: this.requireAuthorizeUrl(
              this.wechatWebOAuthProvider,
            ).buildAuthorizeUrl(state),
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
    context?: RequestOrigin,
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
    context?: RequestOrigin,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.wechatMobileOAuthProvider
      .fetchProfile({ code: dto.code })
      .andThen((profile) => this.loginWithOAuthProfile(profile, context));
  }

  loginWithApple(
    dto: AppleOAuthCallbackDto,
    context?: RequestOrigin,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.appleOAuthProvider
      .fetchProfile({
        identityToken: dto.identityToken,
        ...(dto.authorizationCode !== undefined && {
          authorizationCode: dto.authorizationCode,
        }),
        ...(dto.givenName !== undefined && { givenName: dto.givenName }),
        ...(dto.familyName !== undefined && { familyName: dto.familyName }),
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
            authorizeUrl: this.requireAuthorizeUrl(
              this.qqOAuthProvider,
            ).buildAuthorizeUrl(state, dto?.callbackUri),
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
    context?: RequestOrigin,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.authOAuthStateService
      .consume(OAUTH_PROVIDER_QQ, dto.state, 'login')
      .andThen(() => this.qqOAuthProvider.fetchProfile({ code: dto.code }))
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
            authorizeUrl: this.requireAuthorizeUrl(
              this.googleOAuthProvider,
            ).buildAuthorizeUrl(state, dto?.callbackUri),
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
    context?: RequestOrigin,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.authOAuthStateService
      .consume(OAUTH_PROVIDER_GOOGLE, dto.state, 'login')
      .andThen(() =>
        this.requireTwoStep(this.googleOAuthProvider).exchangeCodeForTokens(
          dto.code,
        ),
      )
      .andThen(({ accessToken, idToken }) =>
        this.requireTwoStep(this.googleOAuthProvider).fetchProfileFromIdToken(
          idToken,
          accessToken,
        ),
      )
      .andThen((profile) => this.loginWithOAuthProfile(profile, context));
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

  /**
   * 取一个「一定能构造授权 URL」的提供商。
   *
   * 端口的 `buildAuthorizeUrl` 是可选的（原生 UI 提供商不实现），而这三个
   * 调用点都明确需要它。缺失意味着**配置/装配错误**——不是业务失败，
   * 所以抛而不是返回 `DomainFailure`（与端口契约里「配置错误抛出」一致）。
   */
  /**
   * 取一个「一定能构造授权 URL」的提供商。
   *
   * 端口的 `buildAuthorizeUrl` 是可选的（原生 UI 提供商不实现），而这三个
   * 调用点都明确需要它。缺失意味着**配置/装配错误**——不是业务失败，
   * 所以抛而不是返回 `DomainFailure`（与端口契约里「配置错误抛出」一致）。
   *
   * 注意**不在这里统一参数个数**：各调用点原本的实参个数不同（微信传 1 个，
   * QQ/Google 传 2 个含 `undefined`），统一会改变对提供商方法的调用形状。
   */
  private requireAuthorizeUrl(
    provider: OAuthProvider,
  ): OAuthProvider & {
    buildAuthorizeUrl: NonNullable<OAuthProvider['buildAuthorizeUrl']>;
  } {
    if (provider.buildAuthorizeUrl === undefined) {
      throw new ServiceUnavailableException({
        code: 'AUTH_METHOD_DISABLED',
        message: `${provider.provider} does not support authorize URLs.`,
      });
    }
    return provider as OAuthProvider & {
      buildAuthorizeUrl: NonNullable<OAuthProvider['buildAuthorizeUrl']>;
    };
  }

  /**
   * 取一个两步式提供商（code → tokens → id token → profile）。
   *
   * 缺任何一个方法都是装配错误，理由同 {@link requireAuthorizeUrl}。
   */
  private requireTwoStep(
    provider: OAuthProvider,
  ): Required<
    Pick<OAuthProvider, 'exchangeCodeForTokens' | 'fetchProfileFromIdToken'>
  > {
    if (
      provider.exchangeCodeForTokens === undefined ||
      provider.fetchProfileFromIdToken === undefined
    ) {
      throw new ServiceUnavailableException({
        code: 'AUTH_METHOD_DISABLED',
        message: `${provider.provider} does not support the two-step flow.`,
      });
    }
    return provider as Required<
      Pick<OAuthProvider, 'exchangeCodeForTokens' | 'fetchProfileFromIdToken'>
    >;
  }

  private loginWithOAuthProfile(
    profile: OAuthProviderProfile,
    context?: RequestOrigin,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    return this.authOAuthService
      .findOrCreateOAuthUser(profile)
      .andThen((user) =>
        this.authOAuthService.updateOAuthLoginUser(user, profile),
      )
      .andThen((updatedUser) =>
        this.sessionTokens
          .issue(toSessionSubject(updatedUser), context)
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
