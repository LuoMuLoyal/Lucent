import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { successEnvelope } from '../common/api-envelope';
import { VERIFICATION_CODE_COOLDOWN_SEC } from './verification-code.service';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { UserPayload } from './auth.service';

import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshDto } from './dto/refresh.dto';
import { SendVerificationCodeDto } from './dto/send-verification-code.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ChangeEmailDto } from './dto/change-email.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';

import {
  ChangeEmailResponseDto,
  ForgotPasswordResponseDto,
  LoginResponseDto,
  MeResponseDto,
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
  async register(@Body() dto: RegisterDto) {
    const result = await this.authService.register(dto);
    return successEnvelope({
      user: {
        id: result.user.id,
        email: result.user.email,
        nickname: result.user.nickname,
        emailVerified: this.toEmailVerified(result.user.emailVerifiedAt),
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
  async login(@Body() dto: LoginDto) {
    const result = await this.authService.login(dto);
    return successEnvelope({
      user: {
        id: result.user.id,
        email: result.user.email,
        nickname: result.user.nickname,
        avatar: result.user.avatar,
        emailVerified: this.toEmailVerified(result.user.emailVerifiedAt),
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
  async logout(@Body() dto: LogoutDto) {
    await this.authService.logout(dto.refreshToken);
    return successEnvelope(null);
  }

  // ── 4. POST /api/v1/auth/refresh ───────────────────────────────
  // No auth guard — accessToken may be expired

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新令牌' })
  @ApiResponse({ status: 200, type: RefreshResponseDto })
  async refresh(@Body() dto: RefreshDto) {
    const result = await this.authService.refresh(dto.refreshToken);
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
  async sendVerificationCode(@Body() dto: SendVerificationCodeDto) {
    const result = await this.authService.sendVerificationCode(dto);
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
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    const result = await this.authService.forgotPassword(dto);
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

  // ── 9. GET /api/v1/auth/me ─────────────────────────────────────

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '获取当前用户信息' })
  @ApiResponse({ status: 200, type: MeResponseDto })
  async getMe(@CurrentUser() user: UserPayload) {
    const me = await this.authService.getMe(user.sub);
    return successEnvelope({
      id: me.id,
      email: me.email,
      nickname: me.nickname,
      avatar: me.avatar,
      emailVerified: this.toEmailVerified(me.emailVerifiedAt),
      createdAt: me.createdAt.toISOString(),
      updatedAt: me.updatedAt.toISOString(),
    });
  }

  // ── 10. PATCH /api/v1/auth/me ──────────────────────────────────

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '更新当前用户信息' })
  @ApiResponse({ status: 200, type: MeResponseDto })
  async updateMe(@CurrentUser() user: UserPayload, @Body() dto: UpdateMeDto) {
    const updated = await this.authService.updateMe(user.sub, dto);
    return successEnvelope({
      id: updated.id,
      email: updated.email,
      nickname: updated.nickname,
      avatar: updated.avatar,
      emailVerified: this.toEmailVerified(updated.emailVerifiedAt),
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  }

  // ── 11. POST /api/v1/auth/me/password ──────────────────────────

  @Post('me/password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '修改密码' })
  @ApiResponse({ status: 200, type: SuccessResponseDto })
  async changePassword(
    @CurrentUser() user: UserPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(user.sub, dto);
    return successEnvelope(null);
  }

  // ── 12. POST /api/v1/auth/me/email ─────────────────────────────

  @Post('me/email')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '修改邮箱' })
  @ApiResponse({ status: 200, type: ChangeEmailResponseDto })
  async changeEmail(
    @CurrentUser() user: UserPayload,
    @Body() dto: ChangeEmailDto,
  ) {
    await this.authService.changeEmail(user.sub, dto);
    return successEnvelope({
      email: dto.newEmail,
      emailVerified: true,
    });
  }

  // ── 13. DELETE /api/v1/auth/me ─────────────────────────────────

  @Delete('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '注销账户' })
  @ApiResponse({ status: 200, type: SuccessResponseDto })
  async deleteAccount(
    @CurrentUser() user: UserPayload,
    @Body() dto: DeleteAccountDto,
  ) {
    await this.authService.deleteAccount(user.sub, dto);
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
}
