import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../config/config-keys.enum';
import {
  calculateExpiresIn,
  formatDateTime,
  toEmailVerified,
} from '../../common/utils/date-time.utils';
import { VERIFICATION_CODE_COOLDOWN_SEC } from './services/verification-code.service';
import { AuthService } from './auth.service';
import { AuthTokenService } from './services/auth-token.service';
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
import { ConfirmTwoFactorDto, VerifyTwoFactorDto } from './dto/two-factor.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authTokenService: AuthTokenService,
    private readonly configService: ConfigService,
  ) {}

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
        emailVerified: toEmailVerified(result.user.emailVerifiedAt),
        emailVerifiedAt: formatDateTime(result.user.emailVerifiedAt),
        createdAt: result.user.createdAt.toISOString(),
      },
      tokens: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: calculateExpiresIn(result.accessTokenExpiresAt),
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
        emailVerified: toEmailVerified(result.user.emailVerifiedAt),
        emailVerifiedAt: formatDateTime(result.user.emailVerifiedAt),
        createdAt: result.user.createdAt.toISOString(),
        updatedAt: result.user.updatedAt.toISOString(),
      },
      tokens: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: calculateExpiresIn(result.accessTokenExpiresAt),
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
        emailVerified: toEmailVerified(result.user.emailVerifiedAt),
        emailVerifiedAt: formatDateTime(result.user.emailVerifiedAt),
        createdAt: result.user.createdAt.toISOString(),
        updatedAt: result.user.updatedAt.toISOString(),
      },
      tokens: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: calculateExpiresIn(result.accessTokenExpiresAt),
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
        emailVerified: toEmailVerified(result.user.emailVerifiedAt),
        emailVerifiedAt: formatDateTime(result.user.emailVerifiedAt),
        createdAt: result.user.createdAt.toISOString(),
        updatedAt: result.user.updatedAt.toISOString(),
      },
      tokens: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: calculateExpiresIn(result.accessTokenExpiresAt),
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

  // ── 3b. GET /api/v1/auth/sessions ──────────────────────────────

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '列出当前用户的活跃会话' })
  async listSessions(@CurrentUser() user: UserPayload) {
    const sessions = await this.authTokenService.listSessions(user.sub);
    return successEnvelope(sessions);
  }

  // ── 3c. DELETE /api/v1/auth/sessions/:sessionId ────────────────

  @Delete('sessions/:sessionId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '撤销指定会话' })
  async revokeSession(
    @CurrentUser() user: UserPayload,
    @Param('sessionId') sessionId: string,
  ) {
    await this.authTokenService.revokeById(user.sub, sessionId);
    return successEnvelope(null);
  }

  // ── 3d. POST /api/v1/auth/2fa/setup ────────────────────────────

  @Post('2fa/setup')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '生成 2FA 绑定密钥和二维码' })
  async setupTwoFactor(@CurrentUser() user: UserPayload) {
    const result = await this.authService.setupTwoFactor(user.sub);
    return successEnvelope(result);
  }

  // ── 3e. POST /api/v1/auth/2fa/confirm ──────────────────────────

  @Post('2fa/confirm')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '确认 2FA 绑定（校验 TOTP）' })
  async confirmTwoFactor(
    @CurrentUser() user: UserPayload,
    @Body() dto: ConfirmTwoFactorDto,
  ) {
    const recoveryCodes = await this.authService.confirmTwoFactor(
      user.sub,
      dto.code,
    );
    return successEnvelope({ recoveryCodes });
  }

  // ── 3f. POST /api/v1/auth/2fa/verify ───────────────────────────

  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '登录后验证 TOTP 或恢复码，签发正式 token' })
  async verifyTwoFactor(@Body() dto: VerifyTwoFactorDto) {
    const result = await this.authService.verifyTwoFactor(dto);
    return successEnvelope(result);
  }

  // ── 3g. DELETE /api/v1/auth/2fa ────────────────────────────────

  @Delete('2fa')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '禁用 2FA' })
  async disableTwoFactor(@CurrentUser() user: UserPayload) {
    await this.authService.disableTwoFactor(user.sub);
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
      expiresIn: calculateExpiresIn(result.accessTokenExpiresAt),
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
      getRequestClientIp(request, this.trustProxy),
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
      getRequestClientIp(request, this.trustProxy),
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

  private get trustProxy(): boolean {
    return this.configService.get<boolean>(
      `${ConfigKey.App}.trustProxy`,
      false,
    );
  }

  private getAuthRequestContext(request: Request): AuthRequestContext {
    const userAgent = request.headers['user-agent'];

    return {
      ipAddress: getRequestClientIp(request, this.trustProxy),
      ...(userAgent !== undefined && { userAgent }),
    };
  }
}
