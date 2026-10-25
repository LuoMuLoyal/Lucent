import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
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
import {
  OAUTH_PROVIDER_TOKENS,
  type OAuthProvider,
} from '../ports/oauth-provider.js';
import {
  OAUTH_PROVIDER_GOOGLE,
  OAUTH_PROVIDER_QQ,
  OAUTH_PROVIDER_WECHAT_WEB,
  type OAuthAuthorizeResult,
} from '../../types/oauth.types.js';
import type { OAuthProviderProfile } from '../../application/ports/oauth-provider.js';
import { AuthNotificationService } from '../../infrastructure/oauth/notifications.js';
import { AuthOAuthService } from '../../infrastructure/oauth/identities.js';
import {
  AuthOAuthStateService,
  type OAuthStateEntry,
} from '../../infrastructure/oauth/state.js';
import {
  SessionTokens,
  type TokenPair,
} from '../../application/services/session-tokens.js';
import { toSessionSubject } from '../../application/services/session-subject.js';
import type { RequestOrigin } from '../../application/ports/request-origin.js';

@Injectable()
export class AuthOAuthFacadeService implements OnModuleInit {
  private readonly logger = new Logger(AuthOAuthFacadeService.name);

  /**
   * ## 为什么每个提供商都要 `@Inject(Token)`
   *
   * `OAuthProvider` 是 **TypeScript interface**——它在运行时不存在，所以
   * **不能**作为 DI token（Nest 会把它当成 `Object`，然后报
   * 「can't resolve dependencies ... index [1]」）。
   *
   * 用显式字符串 token 绑定：每个提供商是不同实例，靠 token 区分。
   * 这也是**为什么这个类不再注入具体类**（那会违反
   * `ddd-application-no-infra-or-adapters`）后必须补的一步——
   * 改成端口的同时就得改成 token 注入，否则应用启动即失败。
   *
   * 这个错误只在**真的把 AuthModule 实例化**时才暴露；单元测试用手工 new
   * 或局部 TestingModule，不会走到这里。所以是 `pnpm export:openapi`
   * （会 `NestFactory.create(AppModule)`）先发现的。
   */
  constructor(
    private readonly userService: UserService,
    @Inject(OAUTH_PROVIDER_TOKENS.wechatWeb)
    private readonly wechatWebOAuthProvider: OAuthProvider,
    @Inject(OAUTH_PROVIDER_TOKENS.wechatMobile)
    private readonly wechatMobileOAuthProvider: OAuthProvider,
    @Inject(OAUTH_PROVIDER_TOKENS.qq)
    private readonly qqOAuthProvider: OAuthProvider,
    @Inject(OAUTH_PROVIDER_TOKENS.google)
    private readonly googleOAuthProvider: OAuthProvider,
    @Inject(OAUTH_PROVIDER_TOKENS.apple)
    private readonly appleOAuthProvider: OAuthProvider,
    private readonly authOAuthStateService: AuthOAuthStateService,
    private readonly sessionTokens: SessionTokens,
    private readonly authOAuthService: AuthOAuthService,
    private readonly authNotificationService: AuthNotificationService,
  ) {}

  /**
   * 启动时校验「每个提供商实现了本编排需要的能力」。
   *
   * ## 为什么在启动时而不是在请求时
   *
   * 端口的 `buildAuthorizeUrl` / `exchangeCodeForTokens` /
   * `fetchProfileFromIdToken` 都是**可选**的（不是所有提供商都用）。
   * 于是「某个提供商忘了实现它该实现的那个」变成了一个**装配错误**——
   * 而装配错误是**编程错误**，不是运行时故障。
   *
   * 如果在请求时才抛 503，运维会以为服务挂了，实际是代码 bug；而且要到
   * 第一个用户真的点「用 Google 登录」才发现。放在这里，**启动即失败**，
   * 部署流水线当场红。
   *
   * ## 为什么不在请求路径上留兜底
   *
   * 请求路径上的 `requireAuthorizeUrl` / `requireTwoStep` 仍然做类型收窄
   * （TypeScript 需要），但**不再是唯一的防线**——启动时已经断言过，
   * 它们运行到那个分支说明断言被绕过了（例如有人手工 new 了这个类）。
   */
  onModuleInit(): void {
    this.assertProviderCapabilities(this.wechatWebOAuthProvider, [
      'buildAuthorizeUrl',
    ]);
    this.assertProviderCapabilities(this.qqOAuthProvider, [
      'buildAuthorizeUrl',
    ]);
    this.assertProviderCapabilities(this.googleOAuthProvider, [
      'buildAuthorizeUrl',
      'exchangeCodeForTokens',
      'fetchProfileFromIdToken',
    ]);
    // 这两个提供商不实现 buildAuthorizeUrl（走原生 UI / 客户端凭据），
    // 所以只断言它们至少有 fetchProfile。
    this.assertProviderCapabilities(this.wechatMobileOAuthProvider, []);
    this.assertProviderCapabilities(this.appleOAuthProvider, []);
  }

  /**
   * 断言某个提供商实现了指定的能力方法。
   *
   * 违规即**抛出**——`onModuleInit` 阶段的抛出是 AGENTS.md 明确豁免的
   * 「模块初始化期配置校验」（此时 `ApiExceptionFilter` 尚未就绪）。
   */
  private assertProviderCapabilities(
    provider: OAuthProvider,
    required: ReadonlyArray<
      'buildAuthorizeUrl' | 'exchangeCodeForTokens' | 'fetchProfileFromIdToken'
    >,
  ): void {
    const missing = required.filter((method) => provider[method] === undefined);
    if (missing.length > 0) {
      // eslint-disable-next-line error-handling/no-bare-throw-error -- DI init: capability assertion is exempt
      throw new Error(
        `OAuth provider "${provider.provider}" is missing required capabilities: ${missing.join(', ')}. This is a wiring bug, not a runtime failure.`,
      );
    }
  }

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
  private requireAuthorizeUrl(provider: OAuthProvider): OAuthProvider & {
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
