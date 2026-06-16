import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { successEnvelope } from '../../common/api-envelope';
import { getRequestClientIp } from '../../common/request/client-ip';
import { VERIFICATION_CODE_COOLDOWN_SEC } from './verification-code.service';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthRequestContext, UserPayload } from './auth.service';

import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshDto } from './dto/refresh.dto';
import { SendVerificationCodeDto } from './dto/send-verification-code.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import {
  OAuthAuthorizeDto,
  OAuthCallbackDto,
  OAuthCodeCallbackDto,
} from './dto/oauth.dto';

import {
  ForgotPasswordResponseDto,
  LoginResponseDto,
  OAuthAuthorizeResponseDto,
  RefreshResponseDto,
  RegisterResponseDto,
  SendVerificationCodeResponseDto,
  SuccessResponseDto,
  VerifyEmailResponseDto,
} from './dto/responses';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ── 1. POST /api/v1/auth/register ──────────────────────────────

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '用户注册' })
  @ApiResponse({ status: 201, type: RegisterResponseDto })
  async register(@Body() dto: RegisterDto, @Req() request: Request) {
    const result = await this.authService.register(
      dto,
      this.getAuthRequestContext(request),
    );
    return successEnvelope({
      user: {
        id: result.user.id,
        email: result.user.email,
        nickname: result.user.nickname,
        emailVerified: this.toEmailVerified(result.user.emailVerifiedAt),
        emailVerifiedAt: this.formatDateTime(result.user.emailVerifiedAt),
        createdAt: result.user.createdAt.toISOString(),
      },
      tokens: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: this.calculateExpiresIn(result.accessTokenExpiresAt),
      },
    });
  }

  // ── 2. POST /api/v1/auth/login ─────────────────────────────────

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用户登录' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async login(@Body() dto: LoginDto, @Req() request: Request) {
    const result = await this.authService.login(
      dto,
      this.getAuthRequestContext(request),
    );
    return successEnvelope({
      user: {
        id: result.user.id,
        email: result.user.email,
        nickname: result.user.nickname,
        avatar: result.user.avatar,
        emailVerified: this.toEmailVerified(result.user.emailVerifiedAt),
        emailVerifiedAt: this.formatDateTime(result.user.emailVerifiedAt),
        createdAt: result.user.createdAt.toISOString(),
        updatedAt: result.user.updatedAt.toISOString(),
      },
      tokens: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: this.calculateExpiresIn(result.accessTokenExpiresAt),
      },
    });
  }

  // ── 2.1 POST /api/v1/auth/oauth/wechat-web/authorize ─────────

  @Post('oauth/wechat-web/authorize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '创建微信网页登录授权地址' })
  @ApiBody({ type: OAuthAuthorizeDto, required: false })
  @ApiResponse({ status: 200, type: OAuthAuthorizeResponseDto })
  async createWechatWebAuthorizeUrl(@Body() dto?: OAuthAuthorizeDto) {
    const result = await this.authService.createWechatWebAuthorizeUrl(dto);
    return successEnvelope(result);
  }

  // ── 2.2 POST /api/v1/auth/oauth/wechat-web/callback ──────────

  @Post('oauth/wechat-web/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '微信网页登录回调登录' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async loginWithWechatWeb(
    @Body() dto: OAuthCallbackDto,
    @Req() request: Request,
  ) {
    const result = await this.authService.loginWithWechatWeb(
      dto,
      this.getAuthRequestContext(request),
    );
    return successEnvelope({
      user: {
        id: result.user.id,
        email: result.user.email,
        nickname: result.user.nickname,
        avatar: result.user.avatar,
        emailVerified: this.toEmailVerified(result.user.emailVerifiedAt),
        emailVerifiedAt: this.formatDateTime(result.user.emailVerifiedAt),
        createdAt: result.user.createdAt.toISOString(),
        updatedAt: result.user.updatedAt.toISOString(),
      },
      tokens: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: this.calculateExpiresIn(result.accessTokenExpiresAt),
      },
    });
  }

  // ── 2.2.1 GET /api/v1/auth/oauth/wechat-web/callback ───────

  @Get('oauth/wechat-web/callback')
  @ApiOperation({ summary: '微信网页登录浏览器回跳' })
  @ApiQuery({ name: 'code', required: true })
  @ApiQuery({ name: 'state', required: true })
  @ApiResponse({ status: 302, description: 'Redirect to desktop callback URI' })
  async redirectWechatWebCallback(
    @Query() dto: OAuthCallbackDto,
    @Res() response: Response,
  ) {
    const redirectUrl =
      await this.authService.resolveWechatWebCallbackRedirect(dto);
    response.redirect(HttpStatus.FOUND, redirectUrl);
  }

  // ── 2.3 POST /api/v1/auth/oauth/wechat-mobile/callback ───────

  @Post('oauth/wechat-mobile/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '微信移动端登录回调' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async loginWithWechatMobile(
    @Body() dto: OAuthCodeCallbackDto,
    @Req() request: Request,
  ) {
    const result = await this.authService.loginWithWechatMobile(
      dto,
      this.getAuthRequestContext(request),
    );
    return successEnvelope({
      user: {
        id: result.user.id,
        email: result.user.email,
        nickname: result.user.nickname,
        avatar: result.user.avatar,
        emailVerified: this.toEmailVerified(result.user.emailVerifiedAt),
        emailVerifiedAt: this.formatDateTime(result.user.emailVerifiedAt),
        createdAt: result.user.createdAt.toISOString(),
        updatedAt: result.user.updatedAt.toISOString(),
      },
      tokens: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: this.calculateExpiresIn(result.accessTokenExpiresAt),
      },
    });
  }

  // ── 3. POST /api/v1/auth/logout ────────────────────────────────

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用户登出' })
  @ApiResponse({ status: 200, type: SuccessResponseDto })
  async logout(@CurrentUser() user: UserPayload, @Body() dto: LogoutDto) {
    await this.authService.logout(user.sub, dto.refreshToken);
    return successEnvelope(null);
  }

  // ── 4. POST /api/v1/auth/refresh ───────────────────────────────
  // No auth guard — accessToken may be expired

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新令牌' })
  @ApiResponse({ status: 200, type: RefreshResponseDto })
  async refresh(@Body() dto: RefreshDto, @Req() request: Request) {
    const result = await this.authService.refresh(
      dto.refreshToken,
      this.getAuthRequestContext(request),
    );
    return successEnvelope({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: this.calculateExpiresIn(result.accessTokenExpiresAt),
    });
  }

  // ── 5. POST /api/v1/auth/send-verification-code ────────────────

  @Post('send-verification-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '发送邮箱验证码' })
  @ApiResponse({ status: 200, type: SendVerificationCodeResponseDto })
  @ApiResponse({ status: 429, description: '验证码接口请求过多' })
  async sendVerificationCode(
    @Body() dto: SendVerificationCodeDto,
    @Req() request: Request,
  ) {
    const result = await this.authService.sendVerificationCode(
      dto,
      getRequestClientIp(request),
    );
    return successEnvelope({
      cooldown: VERIFICATION_CODE_COOLDOWN_SEC,
      message: result.message,
    });
  }

  // ── 6. POST /api/v1/auth/verify-email ──────────────────────────

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '验证邮箱' })
  @ApiResponse({ status: 200, type: VerifyEmailResponseDto })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.authService.verifyEmail(dto);
    return successEnvelope({ emailVerified: true });
  }

  // ── 7. POST /api/v1/auth/forgot-password ───────────────────────

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '忘记密码' })
  @ApiResponse({ status: 200, type: ForgotPasswordResponseDto })
  @ApiResponse({ status: 429, description: '验证码接口请求过多' })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() request: Request,
  ) {
    const result = await this.authService.forgotPassword(
      dto,
      getRequestClientIp(request),
    );
    return successEnvelope({
      cooldown: VERIFICATION_CODE_COOLDOWN_SEC,
      message: result.message,
    });
  }

  // ── 8. POST /api/v1/auth/reset-password ────────────────────────

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '重置密码' })
  @ApiResponse({ status: 200, type: SuccessResponseDto })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return successEnvelope(null);
  }

  // ── Helpers ────────────────────────────────────────────────────

  private calculateExpiresIn(expiresAtIso: string): number {
    const diff = new Date(expiresAtIso).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 1000));
  }

  private toEmailVerified(emailVerifiedAt: Date | null): boolean {
    return emailVerifiedAt !== null;
  }

  private formatDateTime(value: Date | null): string | null {
    return value?.toISOString() ?? null;
  }

  private getAuthRequestContext(request: Request): AuthRequestContext {
    const userAgent = request.headers['user-agent'];

    return {
      ipAddress: getRequestClientIp(request),
      ...(userAgent !== undefined && { userAgent }),
    };
  }
}
