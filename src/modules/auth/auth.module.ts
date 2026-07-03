import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { NotificationsModule } from '../notifications/notifications.module';
import { UserModule } from '../user/user.module';
import { AuthService } from './services/auth.service';
import { AuthController } from './auth.controller';
import { AuthRateLimitService } from './services/auth-rate-limit.service';
import { AuthTokenService } from './services/auth-token.service';
import { AuthOAuthStateService } from './services/auth-oauth-state.service';
import { AuthOAuthService } from './services/auth-oauth.service';
import { CredentialAuthService } from './services/credential-auth.service';
import { VerificationCodeService } from './services/verification-code.service';
import { WechatMobileOAuthProvider } from './providers/wechat-mobile-oauth.provider';
import { WechatWebOAuthProvider } from './providers/wechat-web-oauth.provider';
import { AppleOAuthProvider } from './providers/apple-oauth.provider';
import { QqOAuthProvider } from './providers/qq-oauth.provider';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';

@Module({
  imports: [
    UserModule,
    NotificationsModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}), // actual secret is configured per-sign in AuthService
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRateLimitService,
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
  ],
  exports: [AuthService],
})
export class AuthModule {}
