import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { UserModule } from '../user/user.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthTokenService } from './auth-token.service';
import { AuthOAuthStateService } from './auth-oauth-state.service';
import { VerificationCodeService } from './verification-code.service';
import { WechatMobileOAuthProvider } from './wechat-mobile-oauth.provider';
import { WechatWebOAuthProvider } from './wechat-web-oauth.provider';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';

@Module({
  imports: [
    UserModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}), // actual secret is configured per-sign in AuthService
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRateLimitService,
    AuthTokenService,
    AuthOAuthStateService,
    JwtAccessStrategy,
    VerificationCodeService,
    WechatMobileOAuthProvider,
    WechatWebOAuthProvider,
  ],
  exports: [AuthService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class AuthModule {}
