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

import { successEnvelope } from '../../common';
import { extractAuthRequestContext } from '../../common';
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
import { OAuthAuthorizeResponseDto, SuccessResponseDto } from '../auth';
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
  async getAccount(@CurrentUser() user: UserPayload) {
    return successEnvelope(await this.accountService.getAccount(user.sub));
  }

  @Patch()
  @ApiOperation({ summary: 'Update authenticated account profile' })
  @ApiResponse({ status: 200, type: AccountResponseDto })
  async updateAccount(
    @CurrentUser() user: UserPayload,
    @Body() dto: UpdateAccountDto,
  ) {
    return successEnvelope(
      await this.accountService.updateAccount(user.sub, dto),
    );
  }

  @Post('password')
  @RequireSecurityElevation()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change authenticated account password' })
  @ApiResponse({ status: 200, type: SuccessResponseDto })
  async changePassword(
    @CurrentUser() user: UserPayload,
    @Body() dto: ChangePasswordDto,
    @Req() request: FastifyRequest,
  ) {
    await this.authService.changePassword(user.sub, dto);
    this.auditLogService.logFireAndForget({
      ...extractAuthRequestContext(request),
      userId: user.sub,
      action: 'password.change',
    });
    return successEnvelope(null);
  }

  @Post('set-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Set initial password for OAuth-only account using email verification',
  })
  @ApiResponse({ status: 200, type: SuccessResponseDto })
  async setPassword(
    @CurrentUser() user: UserPayload,
    @Body() dto: SetPasswordDto,
    @Req() request: FastifyRequest,
  ) {
    await this.authService.setPassword(user.sub, dto);
    this.auditLogService.logFireAndForget({
      ...extractAuthRequestContext(request),
      userId: user.sub,
      action: 'password.set',
    });
    return successEnvelope(null);
  }

  @Post('email')
  @RequireSecurityElevation()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change authenticated account email' })
  @ApiResponse({ status: 200, type: AccountEmailResponseDto })
  async changeEmail(
    @CurrentUser() user: UserPayload,
    @Body() dto: ChangeEmailDto,
    @Req() request: FastifyRequest,
  ) {
    const updated = await this.authService.changeEmail(user.sub, dto);
    this.auditLogService.logFireAndForget({
      ...extractAuthRequestContext(request),
      userId: user.sub,
      action: 'email.change',
      metadata: { email: updated.email },
    });
    return successEnvelope({
      email: updated.email,
      emailVerifiedAt: updated.emailVerifiedAt?.toISOString() ?? null,
    });
  }

  @Delete('identities/:identityId')
  @RequireSecurityElevation()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlink authenticated account OAuth identity' })
  @ApiResponse({ status: 200, type: AccountResponseDto })
  async unlinkIdentity(
    @CurrentUser() user: UserPayload,
    @Param('identityId') identityId: string,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.accountService.unlinkIdentity(
      user.sub,
      identityId,
    );
    this.auditLogService.logFireAndForget({
      ...extractAuthRequestContext(request),
      userId: user.sub,
      action: 'identity.unlink',
      resourceType: 'identity',
      resourceId: identityId,
    });
    return successEnvelope(result);
  }

  @Post('identities/wechat-web/authorize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create WeChat web OAuth authorize URL for linking',
  })
  @ApiBody({ type: OAuthAuthorizeDto, required: false })
  @ApiResponse({ status: 200, type: OAuthAuthorizeResponseDto })
  async createWechatWebIdentityLinkAuthorizeUrl(
    @Body() dto?: OAuthAuthorizeDto,
  ) {
    return successEnvelope(
      await this.authService.createWechatWebIdentityLinkAuthorizeUrl(dto),
    );
  }

  @Post('identities/wechat-web/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Link WeChat web identity to authenticated account',
  })
  @ApiResponse({ status: 200, type: AccountResponseDto })
  async linkWechatWebIdentity(
    @CurrentUser() user: UserPayload,
    @Body() dto: OAuthCallbackDto,
    @Req() request: FastifyRequest,
  ) {
    await this.authService.linkWechatWebIdentity(user.sub, dto);
    this.auditLogService.logFireAndForget({
      ...extractAuthRequestContext(request),
      userId: user.sub,
      action: 'identity.link',
      resourceType: 'oauth',
      resourceId: 'wechat_web',
    });
    return successEnvelope(await this.accountService.getAccount(user.sub));
  }

  @Post('identities/wechat-mobile/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Link WeChat mobile identity to authenticated account',
  })
  @ApiResponse({ status: 200, type: AccountResponseDto })
  async linkWechatMobileIdentity(
    @CurrentUser() user: UserPayload,
    @Body() dto: OAuthCodeCallbackDto,
    @Req() request: FastifyRequest,
  ) {
    await this.authService.linkWechatMobileIdentity(user.sub, dto);
    this.auditLogService.logFireAndForget({
      ...extractAuthRequestContext(request),
      userId: user.sub,
      action: 'identity.link',
      resourceType: 'oauth',
      resourceId: 'wechat_mobile',
    });
    return successEnvelope(await this.accountService.getAccount(user.sub));
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete authenticated account' })
  @ApiResponse({ status: 200, type: SuccessResponseDto })
  async deleteAccount(
    @CurrentUser() user: UserPayload,
    @Body() dto: DeleteAccountDto,
    @Req() request: FastifyRequest,
  ) {
    await this.authService.deleteAccount(user.sub, dto);
    this.auditLogService.logFireAndForget({
      ...extractAuthRequestContext(request),
      userId: user.sub,
      action: 'account.delete',
    });
    return successEnvelope(null);
  }
}
