import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  SerializeOptions,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import {
  extractAuthRequestContext,
  getRequestClientIp,
} from '../../../common/index.js';
import { ProblemDetailsDto } from '../../../common/index.js';
import { registerResponseSchema } from '../../../common/api/response-schema.registry.js';
import { unwrapResult } from '../../../common/result/index.js';
import { AuditLogService } from '../../audit-log/index.js';
import { AuthService } from '../services/auth.service.js';
import { VerificationCodeService } from '../services/identity/verification-code.service.js';

import { registerSchema } from '../dto/credentials/register.dto.js';
import type { RegisterDto } from '../dto/credentials/register.dto.js';
import { loginSchema } from '../dto/credentials/login.dto.js';
import type { LoginDto } from '../dto/credentials/login.dto.js';
import { sendVerificationCodeSchema } from '../dto/password/send-verification-code.dto.js';
import type { SendVerificationCodeDto } from '../dto/password/send-verification-code.dto.js';
import { verifyEmailSchema } from '../dto/password/verify-email.dto.js';
import type { VerifyEmailDto } from '../dto/password/verify-email.dto.js';
import { forgotPasswordSchema } from '../dto/password/forgot-password.dto.js';
import type { ForgotPasswordDto } from '../dto/password/forgot-password.dto.js';
import { resetPasswordSchema } from '../dto/password/reset-password.dto.js';
import type { ResetPasswordDto } from '../dto/password/reset-password.dto.js';

import {
  forgotPasswordResponseSchema,
  loginResponseSchema,
  registerResponseSchema as authRegisterResponseSchema,
  sendVerificationCodeResponseSchema,
  verifyEmailResponseSchema,
} from '../dto/shared/auth-responses.dto.js';

import { buildAuthResponse } from './auth-response.helper.js';
import { Public } from '../decorators/public.decorator.js';

@ApiTags('Auth')
@Public()
@Controller('auth')
export class LocalController {
  constructor(
    private readonly authService: AuthService,
    private readonly verificationCodeService: VerificationCodeService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ── POST /api/v1/auth/register ──────────────────────────────

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'User registration' })
  @ApiResponse({
    status: 201,
    description: 'Registered user with token pair.',
  })
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
  @ApiResponse({
    status: 503,
    description: 'Authentication method unavailable',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: authRegisterResponseSchema })
  async register(
    @Body({ schema: registerSchema }) dto: RegisterDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await unwrapResult(
      this.authService.register(dto, extractAuthRequestContext(request)),
    );
    this.auditLogService.logFireAndForget({
      ...extractAuthRequestContext(request),
      userId: result.user.id,
      action: 'user.register',
      resourceType: 'user',
      resourceId: result.user.id,
    });
    return buildAuthResponse(result.user, result);
  }

  // ── POST /api/v1/auth/login ─────────────────────────────────

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login' })
  @ApiResponse({
    status: 200,
    description: 'Authenticated user with token pair.',
  })
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
  @ApiResponse({
    status: 503,
    description: 'Authentication method unavailable',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: loginResponseSchema })
  async login(
    @Body({ schema: loginSchema }) dto: LoginDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await unwrapResult(
      this.authService.login(dto, extractAuthRequestContext(request)),
    );
    return buildAuthResponse(result.user, result);
  }

  // ── POST /api/v1/auth/send-verification-code ────────────────

  @Post('send-verification-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send email verification code' })
  @ApiResponse({
    status: 200,
    description: 'Cooldown seconds until the next code can be requested.',
  })
  @ApiResponse({
    status: 429,
    description:
      'Too many verification code requests (cooldown or client rate limit)',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: sendVerificationCodeResponseSchema })
  async sendVerificationCode(
    @Body({ schema: sendVerificationCodeSchema }) dto: SendVerificationCodeDto,
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
  @ApiResponse({
    status: 200,
    description: 'Whether the email is now verified.',
  })
  @ApiResponse({
    status: 400,
    description: 'Verification token is invalid or has expired',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Authentication failed',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Authentication method unavailable',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: verifyEmailResponseSchema })
  async verifyEmail(@Body({ schema: verifyEmailSchema }) dto: VerifyEmailDto) {
    await unwrapResult(this.authService.verifyEmail(dto));
    return { emailVerified: true };
  }

  // ── POST /api/v1/auth/forgot-password ───────────────────────

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Forgot password' })
  @ApiResponse({
    status: 200,
    description: 'Cooldown seconds until the next reset code can be requested.',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Authentication failed',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 429,
    description:
      'Too many verification code requests (cooldown or client rate limit)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Authentication method unavailable',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: forgotPasswordResponseSchema })
  async forgotPassword(
    @Body({ schema: forgotPasswordSchema }) dto: ForgotPasswordDto,
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
  @ApiResponse({
    status: 401,
    description: 'Authentication failed',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Authentication method unavailable',
    type: ProblemDetailsDto,
  })
  async resetPassword(
    @Body({ schema: resetPasswordSchema }) dto: ResetPasswordDto,
  ) {
    await unwrapResult(this.authService.resetPassword(dto));
    return;
  }
}

// 201 主成功响应注记:export-openapi 目前只把注册组件的 200 响应回写为
// $ref;register 的 201 响应体同样按稳定组件名登记,导出脚本支持 201
// 回写后自动生效。
registerResponseSchema({
  path: '/api/v1/auth/register',
  method: 'post',
  componentName: 'RegisterResponseDto',
  schema: authRegisterResponseSchema,
  description: 'Registered user with token pair.',
});

registerResponseSchema({
  path: '/api/v1/auth/login',
  method: 'post',
  componentName: 'LoginResponseDto',
  schema: loginResponseSchema,
  description: 'Authenticated user with token pair.',
});

registerResponseSchema({
  path: '/api/v1/auth/send-verification-code',
  method: 'post',
  componentName: 'SendVerificationCodeResponseDto',
  schema: sendVerificationCodeResponseSchema,
  description: 'Cooldown seconds until the next code can be requested.',
});

registerResponseSchema({
  path: '/api/v1/auth/verify-email',
  method: 'post',
  componentName: 'VerifyEmailResponseDto',
  schema: verifyEmailResponseSchema,
  description: 'Whether the email is now verified.',
});

registerResponseSchema({
  path: '/api/v1/auth/forgot-password',
  method: 'post',
  componentName: 'ForgotPasswordResponseDto',
  schema: forgotPasswordResponseSchema,
  description: 'Cooldown seconds until the next reset code can be requested.',
});
