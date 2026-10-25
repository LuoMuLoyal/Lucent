import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { NotificationsModule } from '../notifications/notifications.module.js';
import { UserModule } from '../user/user.module.js';
import { MailModule } from '../../mail/mail.module.js';

import { Sessions } from './domain/session/sessions.js';
import { Accounts } from './domain/account/accounts.js';
import { PrismaAccounts } from './infrastructure/persistence/accounts.js';
import { PasswordHasher } from './application/ports/password-hasher.js';
import { Argon2PasswordHasher } from './infrastructure/crypto/argon2.js';
import { PrismaSessions } from './infrastructure/persistence/sessions.js';
import { AccessTokens } from './application/ports/access-tokens.js';
import { JwtAccessTokens } from './infrastructure/security/jwt-access-tokens.js';
import { SessionLifetime } from './application/ports/session-lifetime.js';
import { RuntimeSessionLifetime } from './infrastructure/config/runtime-session-lifetime.js';
import { SessionTokens } from './application/services/session-tokens.js';

import {
  AuthAccountRepository,
  AuthAccountRepositoryPort,
} from './repositories/account.repository.js';
import { LocalController } from './controllers/local.controller.js';
import { OAuthController } from './controllers/oauth.controller.js';
import { SessionController } from './controllers/session.controller.js';
import { CookieSessionController } from './adapters/http/cookie.controller.js';
import { AuthRateLimitService } from './application/services/rate-limit.js';
import { PasswordReauthService } from './application/services/password-reauth.js';
import { AuthOAuthStateService } from './infrastructure/oauth/state.js';
import { AuthOAuthService } from './infrastructure/oauth/identities.js';
import { CredentialAuthService } from './application/services/credential.js';
import { PasswordManagementService } from './application/services/password-management.js';
import { AuthAccountService } from './application/services/account.js';
import { AuthSessionAdminService } from './application/services/session-admin.js';
import { AuthOAuthFacadeService } from './application/services/oauth-facade.js';
import { AuthNotificationService } from './infrastructure/oauth/notifications.js';
import { VerificationCodeService } from './application/services/verification-code.js';
import { WechatMobileOAuthProvider } from './infrastructure/oauth/wechat/wechat-mobile.js';
import { WechatWebOAuthProvider } from './infrastructure/oauth/wechat/wechat-web.js';
import { AppleOAuthProvider } from './infrastructure/oauth/apple.js';
import { GoogleOAuthProvider } from './infrastructure/oauth/google.js';
import { QqOAuthProvider } from './infrastructure/oauth/qq.js';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy.js';
import { CookieSessionUseCase } from './application/use_cases/cookie-session.js';
import { DeleteAccount } from './application/use_cases/delete-account.js';
import { CredentialsSelfService } from './application/ports/credentials-self-service.js';
import { IdentityLink } from './application/ports/identity-link.js';
import { AuthIdentityService } from './application/services/identity.js';
import { HumanVerification } from './application/ports/human-verification.js';
import { OAUTH_PROVIDER_TOKENS } from './application/ports/oauth-provider.js';
import { CloudflareTurnstile } from './infrastructure/verification/cloudflare-turnstile.js';
import { FailureCounters } from './application/ports/failure-counters.js';
import { CacheFailureCounters } from './infrastructure/cache/failure-counters.js';

@Module({
  imports: [
    UserModule,
    NotificationsModule,
    MailModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}), // actual secret is configured per-sign in JwtAccessTokens
  ],
  controllers: [
    LocalController,
    OAuthController,
    SessionController,
    CookieSessionController,
  ],
  providers: [
    // ── 会话聚合（ADR-0024 四层） ──────────────────────────────
    // 端口 → 实现用 useExisting 绑定，adapter 与 use case 都按抽象类注入。
    PrismaSessions,
    { provide: Sessions, useExisting: PrismaSessions },
    PrismaAccounts,
    { provide: Accounts, useExisting: PrismaAccounts },
    Argon2PasswordHasher,
    { provide: PasswordHasher, useExisting: Argon2PasswordHasher },
    JwtAccessTokens,
    { provide: AccessTokens, useExisting: JwtAccessTokens },
    RuntimeSessionLifetime,
    { provide: SessionLifetime, useExisting: RuntimeSessionLifetime },
    SessionTokens,

    AuthAccountRepository,
    {
      provide: AuthAccountRepositoryPort,
      useExisting: AuthAccountRepository,
    },
    AuthAccountService,
    AuthSessionAdminService,
    AuthOAuthFacadeService,
    AuthNotificationService,
    AuthRateLimitService,
    PasswordReauthService,
    AuthOAuthStateService,
    AuthOAuthService,
    CredentialAuthService,
    PasswordManagementService,
    JwtAccessStrategy,
    CookieSessionUseCase,
    DeleteAccount,
    { provide: CredentialsSelfService, useExisting: PasswordManagementService },
    { provide: IdentityLink, useExisting: AuthOAuthFacadeService },
    VerificationCodeService,
    WechatMobileOAuthProvider,
    WechatWebOAuthProvider,
    AppleOAuthProvider,
    QqOAuthProvider,
    GoogleOAuthProvider,
    // `OAuthProvider` 是 interface,不能当 DI token——按提供商绑显式 token。
    // 没有这组别名,`AuthOAuthFacadeService` 的 5 个同类型构造参数会解析成
    // `Object` 并让**整个应用启动失败**(单元测试覆盖不到,只有实例化
    // AuthModule 时才暴露)。
    {
      provide: OAUTH_PROVIDER_TOKENS.wechatWeb,
      useExisting: WechatWebOAuthProvider,
    },
    {
      provide: OAUTH_PROVIDER_TOKENS.wechatMobile,
      useExisting: WechatMobileOAuthProvider,
    },
    { provide: OAUTH_PROVIDER_TOKENS.qq, useExisting: QqOAuthProvider },
    {
      provide: OAUTH_PROVIDER_TOKENS.google,
      useExisting: GoogleOAuthProvider,
    },
    { provide: OAUTH_PROVIDER_TOKENS.apple, useExisting: AppleOAuthProvider },
    AuthIdentityService,
    CloudflareTurnstile,
    { provide: HumanVerification, useExisting: CloudflareTurnstile },
    CacheFailureCounters,
    { provide: FailureCounters, useExisting: CacheFailureCounters },
  ],
  exports: [
    AuthIdentityService,
    PasswordReauthService,
    AuthSessionAdminService,
    HumanVerification,
    CredentialsSelfService,
    IdentityLink,
    DeleteAccount,
  ],
})
export class AuthModule {}
