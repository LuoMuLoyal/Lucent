import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { NotificationsModule } from '../notifications/notifications.module.js';
import { UserModule } from '../user/user.module.js';
import { MailModule } from '../../mail/mail.module.js';
import {
  AuthSessionRepository,
  AuthSessionRepositoryPort,
} from './repositories/session.repository.js';

import {
  AuthAccountRepository,
  AuthAccountRepositoryPort,
} from './repositories/account.repository.js';
import { AuthService } from './services/auth.service.js';
import { LocalController } from './controllers/local.controller.js';
import { OAuthController } from './controllers/oauth.controller.js';
import { SessionController } from './controllers/session.controller.js';
import { CookieSessionController } from './adapters/http/cookie.controller.js';
import { AuthRateLimitService } from './services/identity/rate-limit.service.js';
import { PasswordReauthService } from './services/identity/password-reauth.service.js';
import { AuthTokenService } from './services/token.service.js';
import { AuthOAuthStateService } from './services/oauth/state.service.js';
import { AuthOAuthService } from './services/oauth/oauth.service.js';
import { CredentialAuthService } from './services/identity/credential.service.js';
import { PasswordManagementService } from './services/identity/password-management.service.js';
import { AuthAccountService } from './services/account.service.js';
import { AuthSessionAdminService } from './services/session-admin.service.js';
import { AuthOAuthFacadeService } from './services/oauth/facade.service.js';
import { AuthNotificationService } from './services/notification.service.js';
import { VerificationCodeService } from './services/identity/verification-code.service.js';
import { WechatMobileOAuthProvider } from './providers/wechat/wechat-mobile-oauth.provider.js';
import { WechatWebOAuthProvider } from './providers/wechat/wechat-web-oauth.provider.js';
import { AppleOAuthProvider } from './providers/apple-oauth.provider.js';
import { GoogleOAuthProvider } from './providers/google-oauth.provider.js';
import { QqOAuthProvider } from './providers/qq-oauth.provider.js';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy.js';
import { CookieSessionUseCase } from './application/use_cases/cookie-session.js';
import { AuthIdentityService } from './services/identity/identity.service.js';
import { EmailVerificationService } from './services/identity/email-verification.service.js';
import { TurnstileService } from './services/identity/turnstile.service.js';

@Module({
  imports: [
    UserModule,
    NotificationsModule,
    MailModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}), // actual secret is configured per-sign in AuthService
  ],
  controllers: [
    LocalController,
    OAuthController,
    SessionController,
    CookieSessionController,
  ],
  providers: [
    AuthSessionRepository,
    {
      provide: AuthSessionRepositoryPort,
      useExisting: AuthSessionRepository,
    },
    AuthAccountRepository,
    {
      provide: AuthAccountRepositoryPort,
      useExisting: AuthAccountRepository,
    },
    AuthService,
    AuthAccountService,
    AuthSessionAdminService,
    AuthOAuthFacadeService,
    AuthNotificationService,
    AuthRateLimitService,
    PasswordReauthService,
    AuthTokenService,
    AuthOAuthStateService,
    AuthOAuthService,
    CredentialAuthService,
    PasswordManagementService,
    JwtAccessStrategy,
    CookieSessionUseCase,
    VerificationCodeService,
    WechatMobileOAuthProvider,
    WechatWebOAuthProvider,
    AppleOAuthProvider,
    QqOAuthProvider,
    GoogleOAuthProvider,
    AuthIdentityService,
    EmailVerificationService,
    TurnstileService,
  ],
  exports: [
    AuthService,
    AuthIdentityService,
    PasswordReauthService,
    AuthSessionAdminService,
    TurnstileService,
  ],
})
export class AuthModule {}
