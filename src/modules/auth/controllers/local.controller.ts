import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { successEnvelope } from '../../../common/api';
import { getRequestClientIp } from '../../../common/helpers/client-ip';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../../config/config-keys.enum';
import { AuthService } from '../services/auth.service';
import { VerificationCodeService } from '../services/verification-code.service';
import type { AuthRequestContext } from '../types/auth-request';

import { RegisterDto } from '../dto/register.dto';
import { LoginDto } from '../dto/login.dto';
import { SendVerificationCodeDto } from '../dto/send-verification-code.dto';
import { VerifyEmailDto } from '../dto/verify-email.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';

import {
  ForgotPasswordResponseDto,
  LoginResponseDto,
  RegisterResponseDto,
  SendVerificationCodeResponseDto,
  SuccessResponseDto,
  VerifyEmailResponseDto,
} from '../dto';

import { buildAuthResponse } from './auth-response.helper';

@ApiTags('Auth')
@Controller('auth')
export class LocalController {
  constructor(
    private readonly authService: AuthService,
    private readonly verificationCodeService: VerificationCodeService,
    private readonly configService: ConfigService,
  ) {}

  // ── POST /api/v1/auth/register ──────────────────────────────

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '用户注册' })
  @ApiResponse({ status: 201, type: RegisterResponseDto })
  async register(@Body() dto: RegisterDto, @Req() request: Request) {
    const result = await this.authService.register(
      dto,
      this.getAuthRequestContext(request),
    );
    return buildAuthResponse(result.user, result);
  }

  // ── POST /api/v1/auth/login ─────────────────────────────────

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用户登录' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async login(@Body() dto: LoginDto, @Req() request: Request) {
    const result = await this.authService.login(
      dto,
      this.getAuthRequestContext(request),
    );
    return buildAuthResponse(result.user, result);
  }

  // ── POST /api/v1/auth/send-verification-code ────────────────

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
      cooldown: this.verificationCodeService.getCooldownSec(),
      message: result.message,
    });
  }

  // ── POST /api/v1/auth/verify-email ──────────────────────────

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '验证邮箱' })
  @ApiResponse({ status: 200, type: VerifyEmailResponseDto })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.authService.verifyEmail(dto);
    return successEnvelope({ emailVerified: true });
  }

  // ── POST /api/v1/auth/forgot-password ───────────────────────

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
      cooldown: this.verificationCodeService.getCooldownSec(),
      message: result.message,
    });
  }

  // ── POST /api/v1/auth/reset-password ────────────────────────

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
