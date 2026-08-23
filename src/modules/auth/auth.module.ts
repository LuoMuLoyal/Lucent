import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { NotificationsModule } from '../notifications/notifications.module';
import { UserModule } from '../user/user.module';
import { MailModule } from '../../mail/mail.module';
import {
  AuthSessionRepository,
  AuthSessionRepositoryPort,
} from './repositories/session.repository';

import {
  AuthAccountRepository,
  AuthAccountRepositoryPort,
} from './repositories/account.repository';
import { AuthService } from './services/auth.service';
import { LocalController } from './controllers/local.controller';
import { OAuthController } from './controllers/oauth.controller';
import { SessionController } from './controllers/session.controller';
import { AuthRateLimitService } from './services/identity/rate-limit.service';
import { PasswordReauthService } from './services/identity/password-reauth.service';
import { AuthTokenService } from './services/token.service';
import { AuthOAuthStateService } from './services/oauth/state.service';
import { AuthOAuthService } from './services/oauth/oauth.service';
import { CredentialAuthService } from './services/identity/credential.service';
import { AuthAccountService } from './services/account.service';
import { AuthOAuthFacadeService } from './services/oauth/facade.service';
import { AuthNotificationService } from './services/notification.service';
import { VerificationCodeService } from './services/identity/verification-code.service';
import { WechatMobileOAuthProvider } from './providers/wechat/wechat-mobile-oauth.provider';
import { WechatWebOAuthProvider } from './providers/wechat/wechat-web-oauth.provider';
import { AppleOAuthProvider } from './providers/apple-oauth.provider';
import { GoogleOAuthProvider } from './providers/google-oauth.provider';
import { QqOAuthProvider } from './providers/qq-oauth.provider';
import { WeiboOAuthProvider } from './providers/weibo-oauth.provider';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { AuthBetterAuthAdapter } from './adapters/better-auth.adapter.js';

@Module({
  imports: [
    UserModule,
    NotificationsModule,
    MailModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}), // actual secret is configured per-sign in AuthService
  ],
  controllers: [LocalController, OAuthController, SessionController],
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
    AuthOAuthFacadeService,
    AuthNotificationService,
    AuthRateLimitService,
    PasswordReauthService,
    AuthTokenService,
    AuthOAuthStateService,
    AuthOAuthService,
    CredentialAuthService,
    JwtAccessStrategy,
    VerificationCodeService,
    WechatMobileOAuthProvider,
    WechatWebOAuthProvider,
    AppleOAuthProvider,
    QqOAuthProvider,
    WeiboOAuthProvider,
    GoogleOAuthProvider,
    AuthBetterAuthAdapter,
  ],
  exports: [AuthService, AuthBetterAuthAdapter, PasswordReauthService],
})
export class AuthModule {}
