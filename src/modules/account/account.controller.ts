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
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import {
  extractAuthRequestContext,
  ProblemDetailsDto,
} from '../../common/index.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import { unwrapResult } from '../../common/result/index.js';
import { AuditLogService } from '../audit-log/index.js';
import { AuthService } from '../auth/index.js';

import type { UserPayload } from '../auth/index.js';
import { CurrentUser } from '../auth/index.js';
import {
  changeEmailSchema,
  changePasswordSchema,
  deleteAccountSchema,
  oauthAuthorizeSchema,
  oauthCallbackSchema,
  oauthCodeCallbackSchema,
  setPasswordSchema,
} from '../auth/index.js';
import { oauthAuthorizeResponseSchema } from '../auth/index.js';
import type {
  ChangeEmailDto,
  ChangePasswordDto,
  DeleteAccountDto,
  OAuthAuthorizeDto,
  OAuthCallbackDto,
  OAuthCodeCallbackDto,
  SetPasswordDto,
} from '../auth/index.js';
import { AccountService } from './services/account.service.js';
import {
  accountDataSchema,
  accountEmailDataSchema,
} from './dto/response.dto.js';
import { unlinkIdentitySchema } from './dto/unlink-identity.dto.js';
import type { UnlinkIdentityDto } from './dto/unlink-identity.dto.js';
import { updateAccountSchema } from './dto/update.dto.js';
import type { UpdateAccountDto } from './dto/update.dto.js';

@ApiTags('Account')
@ApiBearerAuth('access-token')
@Controller('account')
export class AccountController {
  constructor(
    private readonly accountService: AccountService,
    private readonly authService: AuthService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get authenticated account profile' })
  @ApiResponse({
    status: 200,
    description: 'Authenticated account profile.',
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: accountDataSchema })
  async getAccount(@CurrentUser() user: UserPayload) {
    return unwrapResult(this.accountService.getAccount(user.sub));
  }

  @Patch()
  @ApiOperation({ summary: 'Update authenticated account profile' })
  @ApiResponse({
    status: 200,
    description: 'Updated authenticated account profile.',
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: accountDataSchema })
  async updateAccount(
    @CurrentUser() user: UserPayload,
    @Body({ schema: updateAccountSchema }) dto: UpdateAccountDto,
  ) {
    return unwrapResult(this.accountService.updateAccount(user.sub, dto));
  }

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change authenticated account password' })
  @ApiResponse({ status: 204, description: 'Password changed.' })
  @ApiResponse({
    status: 401,
    description:
      'Wrong password (AUTH_WRONG_PASSWORD) or no password set (AUTH_PASSWORD_NOT_SET)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 429,
    description: 'Too many failed re-authentication attempts',
    type: ProblemDetailsDto,
  })
  async changePassword(
    @CurrentUser() user: UserPayload,
    @Body({ schema: changePasswordSchema }) dto: ChangePasswordDto,
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
    @Body({ schema: setPasswordSchema }) dto: SetPasswordDto,
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
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change authenticated account email' })
  @ApiResponse({
    status: 200,
    description: 'Updated account email with verification time.',
  })
  @ApiResponse({
    status: 400,
    description: 'Verification code expired or does not match',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 401,
    description:
      'Wrong password (AUTH_WRONG_PASSWORD) or no password set (AUTH_PASSWORD_NOT_SET)',
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
  @ApiResponse({
    status: 429,
    description: 'Too many failed re-authentication attempts',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: accountEmailDataSchema })
  async changeEmail(
    @CurrentUser() user: UserPayload,
    @Body({ schema: changeEmailSchema }) dto: ChangeEmailDto,
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
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlink authenticated account OAuth identity' })
  @ApiResponse({
    status: 200,
    description: 'Account profile with the identity unlinked.',
  })
  @ApiResponse({
    status: 401,
    description:
      'Wrong password (AUTH_WRONG_PASSWORD) or no password set (AUTH_PASSWORD_NOT_SET)',
    type: ProblemDetailsDto,
  })
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
  @ApiResponse({
    status: 429,
    description: 'Too many failed re-authentication attempts',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: accountDataSchema })
  async unlinkIdentity(
    @CurrentUser() user: UserPayload,
    @Param('identityId') identityId: string,
    @Body({ schema: unlinkIdentitySchema }) dto: UnlinkIdentityDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await unwrapResult(
      this.accountService.unlinkIdentity(user.sub, identityId, dto),
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
  @ApiResponse({ status: 200, description: 'OAuth authorize URL.' })
  @SerializeOptions({ schema: oauthAuthorizeResponseSchema })
  @ApiResponse({
    status: 400,
    description: 'Invalid callback URI',
    type: ProblemDetailsDto,
  })
  async createWechatWebIdentityLinkAuthorizeUrl(
    @Body({ schema: oauthAuthorizeSchema }) dto?: OAuthAuthorizeDto,
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
  @ApiResponse({
    status: 200,
    description: 'Account profile with the linked identity.',
  })
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
  @SerializeOptions({ schema: accountDataSchema })
  async linkWechatWebIdentity(
    @CurrentUser() user: UserPayload,
    @Body({ schema: oauthCallbackSchema }) dto: OAuthCallbackDto,
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
  @ApiResponse({
    status: 200,
    description: 'Account profile with the linked identity.',
  })
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
  @SerializeOptions({ schema: accountDataSchema })
  async linkWechatMobileIdentity(
    @CurrentUser() user: UserPayload,
    @Body({ schema: oauthCodeCallbackSchema }) dto: OAuthCodeCallbackDto,
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
    description:
      'Wrong password (AUTH_WRONG_PASSWORD), no password set (AUTH_PASSWORD_NOT_SET), or OAuth-only code mismatch',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 429,
    description: 'Too many failed re-authentication attempts',
    type: ProblemDetailsDto,
  })
  async deleteAccount(
    @CurrentUser() user: UserPayload,
    @Body({ schema: deleteAccountSchema }) dto: DeleteAccountDto,
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

registerResponseSchema({
  path: '/api/v1/account',
  method: 'get',
  componentName: 'AccountResponse',
  schema: accountDataSchema,
  description: 'Authenticated account profile.',
});

registerResponseSchema({
  path: '/api/v1/account',
  method: 'patch',
  componentName: 'AccountResponse',
  schema: accountDataSchema,
  description: 'Updated authenticated account profile.',
});

registerResponseSchema({
  path: '/api/v1/account/email',
  method: 'post',
  componentName: 'AccountEmailResponse',
  schema: accountEmailDataSchema,
  description: 'Updated account email with verification time.',
});

registerResponseSchema({
  path: '/api/v1/account/identities/{identityId}',
  method: 'delete',
  componentName: 'AccountResponse',
  schema: accountDataSchema,
  description: 'Account profile with the identity unlinked.',
});

registerResponseSchema({
  path: '/api/v1/account/identities/wechat-web/callback',
  method: 'post',
  componentName: 'AccountResponse',
  schema: accountDataSchema,
  description: 'Account profile with the linked identity.',
});

registerResponseSchema({
  path: '/api/v1/account/identities/wechat-mobile/callback',
  method: 'post',
  componentName: 'AccountResponse',
  schema: accountDataSchema,
  description: 'Account profile with the linked identity.',
});

registerResponseSchema({
  path: '/api/v1/account/identities/wechat-web/authorize',
  method: 'post',
  componentName: 'OAuthAuthorizeResponse',
  schema: oauthAuthorizeResponseSchema,
  description: 'WeChat web OAuth authorize URL for identity linking.',
});
