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

import { extractAuthRequestContext, getRequestClientIp } from '../../../common';
import { ProblemDetailsDto } from '../../../common';
import { unwrapResult } from '../../../common/result';
import { AuthService } from '../services/auth.service';
import { VerificationCodeService } from '../services/identity/verification-code.service';

import { RegisterDto } from '../dto/credentials/register.dto';
import { LoginDto } from '../dto/credentials/login.dto';
import { SendVerificationCodeDto } from '../dto/password/send-verification-code.dto';
import { VerifyEmailDto } from '../dto/password/verify-email.dto';
import { ForgotPasswordDto } from '../dto/password/forgot-password.dto';
import { ResetPasswordDto } from '../dto/password/reset-password.dto';

import {
  ForgotPasswordResponseDto,
  LoginResponseDto,
  RegisterResponseDto,
  SendVerificationCodeResponseDto,
  VerifyEmailResponseDto,
} from '../dto/shared/auth-responses.dto';

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
  @ApiOperation({ summary: 'User registration' })
  @ApiResponse({ status: 201, type: RegisterResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Verification code expired or does not match',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 401,
    description:
      'Anti-enumeration credential failure (email already registered is indistinguishable from a wrong verification code)',
    type: ProblemDetailsDto,
  })
  async register(@Body() dto: RegisterDto, @Req() request: FastifyRequest) {
    const result = await unwrapResult(
      this.authService.register(dto, extractAuthRequestContext(request)),
    );
    return buildAuthResponse(result.user, result);
  }

  // ── POST /api/v1/auth/login ─────────────────────────────────

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Login verification code expired or does not match',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 401,
    description:
      'Wrong credentials (unified code; account state is not revealed)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 429,
    description: 'Too many failed login attempts',
    type: ProblemDetailsDto,
  })
  async login(@Body() dto: LoginDto, @Req() request: FastifyRequest) {
    const result = await unwrapResult(
      this.authService.login(dto, extractAuthRequestContext(request)),
    );
    return buildAuthResponse(result.user, result);
  }

  // ── POST /api/v1/auth/send-verification-code ────────────────

  @Post('send-verification-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send email verification code' })
  @ApiResponse({ status: 200, type: SendVerificationCodeResponseDto })
  @ApiResponse({
    status: 429,
    description:
      'Too many verification code requests (cooldown or client rate limit)',
    type: ProblemDetailsDto,
  })
  async sendVerificationCode(
    @Body() dto: SendVerificationCodeDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await unwrapResult(
      this.authService.sendVerificationCode(dto, getRequestClientIp(request)),
    );

    return {
      cooldown: this.verificationCodeService.getCooldownSec(),
      message: result.message,
    };
  }

  // ── POST /api/v1/auth/verify-email ──────────────────────────

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email' })
  @ApiResponse({ status: 200, type: VerifyEmailResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Verification token is invalid or has expired',
    type: ProblemDetailsDto,
  })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await unwrapResult(this.authService.verifyEmail(dto));
    return { emailVerified: true };
  }

  // ── POST /api/v1/auth/forgot-password ───────────────────────

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Forgot password' })
  @ApiResponse({ status: 200, type: ForgotPasswordResponseDto })
  @ApiResponse({
    status: 429,
    description:
      'Too many verification code requests (cooldown or client rate limit)',
    type: ProblemDetailsDto,
  })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await unwrapResult(
      this.authService.forgotPassword(dto, getRequestClientIp(request)),
    );

    return {
      cooldown: this.verificationCodeService.getCooldownSec(),
      message: result.message,
    };
  }

  // ── POST /api/v1/auth/reset-password ────────────────────────

  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reset password' })
  @ApiResponse({ status: 204, description: 'Password reset.' })
  @ApiResponse({
    status: 400,
    description: 'Reset token is invalid, expired, or the password is invalid',
    type: ProblemDetailsDto,
  })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await unwrapResult(this.authService.resetPassword(dto));
    return;
  }
}
