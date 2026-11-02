import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  SerializeOptions,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { I18nLang, I18nService } from 'nestjs-i18n';

import {
  extractAuthRequestContext,
  getRequestClientIp,
} from '../../../common/index.js';
import { ProblemDetailsDto } from '../../../common/index.js';
import { registerResponseSchema } from '../../../common/api/response-schema.registry.js';
import { unwrapResult } from '../../../common/result/index.js';
import { AuditLogService } from '../../audit-log/index.js';
import { CredentialAuthService } from '../application/services/credential.js';
import { PasswordManagementService } from '../application/services/password-management.js';
import { HumanVerification } from '../application/ports/human-verification.js';
import { VerificationCodeService } from '../application/services/verification-code.js';

import { registerSchema } from '../dto/credentials/register.dto.js';
import type { RegisterDto } from '../dto/credentials/register.dto.js';
import { loginSchema } from '../dto/credentials/login.dto.js';
import type { LoginDto } from '../dto/credentials/login.dto.js';
import { sendVerificationCodeSchema } from '../dto/password/send-verification-code.dto.js';
import type { SendVerificationCodeDto } from '../dto/password/send-verification-code.dto.js';
import { forgotPasswordSchema } from '../dto/password/forgot-password.dto.js';
import type { ForgotPasswordDto } from '../dto/password/forgot-password.dto.js';
import { resetPasswordSchema } from '../dto/password/reset-password.dto.js';
import type { ResetPasswordDto } from '../dto/password/reset-password.dto.js';
import { captchaSchema } from '../dto/shared/captcha.dto.js';

import {
  forgotPasswordResponseSchema,
  loginResponseSchema,
  registerResponseSchema as authRegisterResponseSchema,
  resetPasswordResponseSchema,
  sendVerificationCodeResponseSchema,
} from '../dto/shared/auth-responses.dto.js';

import { buildAuthResponse } from './auth-response.helper.js';
import { Public } from '../decorators/public.decorator.js';

@ApiTags('Auth')
@Public()
@Controller('auth')
export class LocalController {
  constructor(
    private readonly credentialAuthService: CredentialAuthService,
    private readonly passwordManagement: PasswordManagementService,
    private readonly verificationCodeService: VerificationCodeService,
    private readonly auditLogService: AuditLogService,
    private readonly turnstileService: HumanVerification,
    private readonly i18n: I18nService,
  ) {}

  // ── POST /api/v1/auth/register ──────────────────────────────

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: 'register', summary: 'User registration' })
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
      this.credentialAuthService.register(
        dto,
        extractAuthRequestContext(request),
      ),
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
  @ApiOperation({ operationId: 'login', summary: 'User login' })
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
      this.credentialAuthService.login(dto, extractAuthRequestContext(request)),
    );
    return buildAuthResponse(result.user, result);
  }

  // ── GET /api/v1/auth/captcha ────────────────────────────────

  @Get('captcha')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'getCaptcha',
    summary: 'Public human-verification widget configuration',
  })
  @ApiResponse({
    status: 200,
    description:
      'Whether the challenge is enforced and the public site key to render it with.',
  })
  @SerializeOptions({ schema: captchaSchema })
  getCaptcha() {
    return {
      enabled: this.turnstileService.enabled,
      siteKey: this.turnstileService.siteKey,
    };
  }

  // ── POST /api/v1/auth/send-verification-code ────────────────

  @Post('send-verification-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'sendVerificationCode',
    summary: 'Send email verification code',
  })
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
    @I18nLang() locale?: string,
  ) {
    const result = await unwrapResult(
      this.passwordManagement.sendVerificationCode(
        dto,
        getRequestClientIp(request),
        locale,
      ),
    );

    return {
      cooldown: this.verificationCodeService.getCooldownSec(),
      message: result.message,
    };
  }

  // ── POST /api/v1/auth/forgot-password ───────────────────────

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'forgotPassword', summary: 'Forgot password' })
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
    @I18nLang() locale?: string,
  ) {
    const result = await unwrapResult(
      this.passwordManagement.forgotPassword(
        dto,
        getRequestClientIp(request),
        locale,
      ),
    );

    return {
      cooldown: this.verificationCodeService.getCooldownSec(),
      message: result.message,
    };
  }

  // ── POST /api/v1/auth/reset-password ────────────────────────

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'resetPassword', summary: 'Reset password' })
  @ApiResponse({
    status: 200,
    description: 'Password reset. Returns a confirmation message.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Verification code is invalid/expired, or the password is invalid',
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
  @SerializeOptions({ schema: resetPasswordResponseSchema })
  async resetPassword(
    @Body({ schema: resetPasswordSchema }) dto: ResetPasswordDto,
  ) {
    await unwrapResult(this.passwordManagement.resetPassword(dto));
    return {
      cooldown: this.verificationCodeService.getCooldownSec(),
      message: this.i18n.t('auth.reset_password_success'),
    };
  }
}

// 201 主成功响应注记:export-openapi 目前只把注册组件的 200 响应回写为
// $ref;register 的 201 响应体同样按稳定组件名登记,导出脚本支持 201
// 回写后自动生效。
registerResponseSchema({
  path: '/api/v1/auth/register',
  method: 'post',
  componentName: 'RegisterResponse',
  schema: authRegisterResponseSchema,
  description: 'Registered user with token pair.',
});

registerResponseSchema({
  path: '/api/v1/auth/login',
  method: 'post',
  componentName: 'LoginResponse',
  schema: loginResponseSchema,
  description: 'Authenticated user with token pair.',
});

registerResponseSchema({
  path: '/api/v1/auth/captcha',
  method: 'get',
  componentName: 'CaptchaResponse',
  schema: captchaSchema,
  description: 'Whether the challenge is enforced and the public site key.',
});

registerResponseSchema({
  path: '/api/v1/auth/send-verification-code',
  method: 'post',
  componentName: 'SendVerificationCodeResponse',
  schema: sendVerificationCodeResponseSchema,
  description: 'Cooldown seconds until the next code can be requested.',
});

registerResponseSchema({
  path: '/api/v1/auth/forgot-password',
  method: 'post',
  componentName: 'ForgotPasswordResponse',
  schema: forgotPasswordResponseSchema,
  description: 'Cooldown seconds until the next reset code can be requested.',
});

registerResponseSchema({
  path: '/api/v1/auth/reset-password',
  method: 'post',
  componentName: 'ResetPasswordResponse',
  schema: resetPasswordResponseSchema,
  description: 'Password reset confirmation.',
});
