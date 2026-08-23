import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { extractAuthRequestContext, ProblemDetailsDto } from '../../common';
import { unwrapResult } from '../../common/result';
import { AuditLogService } from '../audit-log';
import { AuthService } from '../auth';

import type { UserPayload } from '../auth';
import { CurrentUser } from '../auth';
import { SecurityElevationGuard } from '../security-pin';
import { RequireSecurityElevation } from '../security-pin';
import { ChangeEmailDto } from '../auth';
import { ChangePasswordDto } from '../auth';
import { SetPasswordDto } from '../auth';
import { DeleteAccountDto } from '../auth';
import { OAuthAuthorizeResponseDto } from '../auth';
import {
  OAuthAuthorizeDto,
  OAuthCallbackDto,
  OAuthCodeCallbackDto,
} from '../auth';
import { AccountService } from './services/account.service';
import {
  AccountEmailResponseDto,
  AccountResponseDto,
} from './dto/response.dto';

import { UpdateAccountDto } from './dto/update.dto';

@ApiTags('Account')
@ApiBearerAuth('access-token')
@UseGuards(SecurityElevationGuard)
@Controller('account')
export class AccountController {
  constructor(
    private readonly accountService: AccountService,
    private readonly authService: AuthService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get authenticated account profile' })
  @ApiResponse({ status: 200, type: AccountResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Account not found',
    type: ProblemDetailsDto,
  })
  async getAccount(@CurrentUser() user: UserPayload) {
    return unwrapResult(this.accountService.getAccount(user.sub));
  }

  @Patch()
  @ApiOperation({ summary: 'Update authenticated account profile' })
  @ApiResponse({ status: 200, type: AccountResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Account not found',
    type: ProblemDetailsDto,
  })
  async updateAccount(
    @CurrentUser() user: UserPayload,
    @Body() dto: UpdateAccountDto,
  ) {
    return unwrapResult(this.accountService.updateAccount(user.sub, dto));
  }

  @Post('password')
  @RequireSecurityElevation()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change authenticated account password' })
  @ApiResponse({ status: 204, description: 'Password changed.' })
  @ApiResponse({
    status: 401,
    description:
      'Wrong old password (unified code; account password state is not revealed)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found',
    type: ProblemDetailsDto,
  })
  async changePassword(
    @CurrentUser() user: UserPayload,
    @Body() dto: ChangePasswordDto,
    @Req() request: FastifyRequest,
  ) {
    await unwrapResult(this.authService.changePassword(user.sub, dto));
    this.auditLogService.logFireAndForget({
      ...extractAuthRequestContext(request),
      userId: user.sub,
      action: 'password.change',
    });
    return;
  }

  @Post('set-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Set initial password for OAuth-only account using email verification',
  })
  @ApiResponse({ status: 204, description: 'Password set.' })
  @ApiResponse({
    status: 400,
    description:
      'Verification code expired or does not match, or target email is missing',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Password already set or email already in use',
    type: ProblemDetailsDto,
  })
  async setPassword(
    @CurrentUser() user: UserPayload,
    @Body() dto: SetPasswordDto,
    @Req() request: FastifyRequest,
  ) {
    await unwrapResult(this.authService.setPassword(user.sub, dto));
    this.auditLogService.logFireAndForget({
      ...extractAuthRequestContext(request),
      userId: user.sub,
      action: 'password.set',
    });
    return;
  }

  @Post('email')
  @RequireSecurityElevation()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change authenticated account email' })
  @ApiResponse({ status: 200, type: AccountEmailResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Verification code expired or does not match',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Email already in use',
    type: ProblemDetailsDto,
  })
  async changeEmail(
    @CurrentUser() user: UserPayload,
    @Body() dto: ChangeEmailDto,
    @Req() request: FastifyRequest,
  ) {
    const updated = await unwrapResult(
      this.authService.changeEmail(user.sub, dto),
    );
    this.auditLogService.logFireAndForget({
      ...extractAuthRequestContext(request),
      userId: user.sub,
      action: 'email.change',
      metadata: { email: updated.email },
    });
    return {
      email: updated.email,
      emailVerifiedAt: updated.emailVerifiedAt?.toISOString() ?? null,
    };
  }

  @Delete('identities/:identityId')
  @RequireSecurityElevation()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlink authenticated account OAuth identity' })
  @ApiResponse({ status: 200, type: AccountResponseDto })
  @ApiResponse({
    status: 403,
    description:
      'Cannot unlink the last identity while the account has no password',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Account or identity not found',
    type: ProblemDetailsDto,
  })
  async unlinkIdentity(
    @CurrentUser() user: UserPayload,
    @Param('identityId') identityId: string,
    @Req() request: FastifyRequest,
  ) {
    const result = await unwrapResult(
      this.accountService.unlinkIdentity(user.sub, identityId),
    );
    this.auditLogService.logFireAndForget({
      ...extractAuthRequestContext(request),
      userId: user.sub,
      action: 'identity.unlink',
      resourceType: 'identity',
      resourceId: identityId,
    });
    return result;
  }

  @Post('identities/wechat-web/authorize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create WeChat web OAuth authorize URL for linking',
  })
  @ApiBody({ type: OAuthAuthorizeDto, required: false })
  @ApiResponse({ status: 200, type: OAuthAuthorizeResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid callback URI',
    type: ProblemDetailsDto,
  })
  async createWechatWebIdentityLinkAuthorizeUrl(
    @Body() dto?: OAuthAuthorizeDto,
  ) {
    return unwrapResult(
      this.authService.createWechatWebIdentityLinkAuthorizeUrl(dto),
    );
  }

  @Post('identities/wechat-web/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Link WeChat web identity to authenticated account',
  })
  @ApiResponse({ status: 200, type: AccountResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid OAuth state or missing/malformed callback credential',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 409,
    description: 'OAuth identity is already linked to another account',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 502,
    description:
      'OAuth provider rejected the exchange or returned an unusable profile',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 503,
    description: 'OAuth provider is unavailable',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 504,
    description: 'OAuth provider timed out',
    type: ProblemDetailsDto,
  })
  async linkWechatWebIdentity(
    @CurrentUser() user: UserPayload,
    @Body() dto: OAuthCallbackDto,
    @Req() request: FastifyRequest,
  ) {
    await unwrapResult(this.authService.linkWechatWebIdentity(user.sub, dto));
    this.auditLogService.logFireAndForget({
      ...extractAuthRequestContext(request),
      userId: user.sub,
      action: 'identity.link',
      resourceType: 'oauth',
      resourceId: 'wechat_web',
    });
    return unwrapResult(this.accountService.getAccount(user.sub));
  }

  @Post('identities/wechat-mobile/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Link WeChat mobile identity to authenticated account',
  })
  @ApiResponse({ status: 200, type: AccountResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Missing/malformed callback credential',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 409,
    description: 'OAuth identity is already linked to another account',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 502,
    description:
      'OAuth provider rejected the exchange or returned an unusable profile',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 503,
    description: 'OAuth provider is unavailable',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 504,
    description: 'OAuth provider timed out',
    type: ProblemDetailsDto,
  })
  async linkWechatMobileIdentity(
    @CurrentUser() user: UserPayload,
    @Body() dto: OAuthCodeCallbackDto,
    @Req() request: FastifyRequest,
  ) {
    await unwrapResult(
      this.authService.linkWechatMobileIdentity(user.sub, dto),
    );
    this.auditLogService.logFireAndForget({
      ...extractAuthRequestContext(request),
      userId: user.sub,
      action: 'identity.link',
      resourceType: 'oauth',
      resourceId: 'wechat_mobile',
    });
    return unwrapResult(this.accountService.getAccount(user.sub));
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete authenticated account' })
  @ApiResponse({ status: 204, description: 'Account deleted.' })
  @ApiResponse({
    status: 400,
    description:
      'Verification code expired or does not match, or neither password nor code provided',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Wrong password',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found',
    type: ProblemDetailsDto,
  })
  async deleteAccount(
    @CurrentUser() user: UserPayload,
    @Body() dto: DeleteAccountDto,
    @Req() request: FastifyRequest,
  ) {
    await unwrapResult(this.authService.deleteAccount(user.sub, dto));
    this.auditLogService.logFireAndForget({
      ...extractAuthRequestContext(request),
      userId: user.sub,
      action: 'account.delete',
    });
    return;
  }
}
