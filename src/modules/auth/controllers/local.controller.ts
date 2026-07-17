import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { successEnvelope } from '../../../common/api';
import {
  extractAuthRequestContext,
  getRequestClientIp,
} from '../../../common/helpers/client-ip';
import { AuthService } from '../services/auth.service';
import { VerificationCodeService } from '../services/identity';

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
import { Public } from '../decorators/public.decorator';

@ApiTags('Auth')
@Public()
@Controller('auth')
export class LocalController {
  constructor(
    private readonly authService: AuthService,
    private readonly verificationCodeService: VerificationCodeService,
  ) {}

  // ── POST /api/v1/auth/register ──────────────────────────────

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '用户注册' })
  @ApiResponse({ status: 201, type: RegisterResponseDto })
  async register(@Body() dto: RegisterDto, @Req() request: FastifyRequest) {
    const result = await this.authService.register(
      dto,
      extractAuthRequestContext(request),
    );
    return buildAuthResponse(result.user, result);
  }

  // ── POST /api/v1/auth/login ─────────────────────────────────

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用户登录' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async login(@Body() dto: LoginDto, @Req() request: FastifyRequest) {
    const result = await this.authService.login(
      dto,
      extractAuthRequestContext(request),
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
    @Req() request: FastifyRequest,
  ) {
    const result = await this.authService.sendVerificationCode(
      dto,
      getRequestClientIp(request),
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
    @Req() request: FastifyRequest,
  ) {
    const result = await this.authService.forgotPassword(
      dto,
      getRequestClientIp(request),
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
}
