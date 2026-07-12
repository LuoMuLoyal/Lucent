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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { successEnvelope } from '../../common/api';
import { AuthService, type UserPayload } from '../auth/services/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SecurityElevationGuard } from '../security-pin/guards';
import { RequireSecurityElevation } from '../security-pin/decorators';
import { ChangeEmailDto } from '../auth/dto/change-email.dto';
import { ChangePasswordDto } from '../auth/dto/change-password.dto';
import { SetPasswordDto } from '../auth/dto/set-password.dto';
import { DeleteAccountDto } from '../auth/dto/delete-account.dto';
import { OAuthAuthorizeResponseDto, SuccessResponseDto } from '../auth/dto';
import {
  OAuthAuthorizeDto,
  OAuthCallbackDto,
  OAuthCodeCallbackDto,
} from '../auth/dto/oauth.dto';
import { AccountService } from './services/account.service';
import {
  AccountEmailResponseDto,
  AccountResponseDto,
} from './dto/response.dto';
import { UpdateAccountDto } from './dto/update.dto';

@ApiTags('Account')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, SecurityElevationGuard)
@Controller('account')
export class AccountController {
  constructor(
    private readonly accountService: AccountService,
    private readonly authService: AuthService,
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
  ) {
    await this.authService.changePassword(user.sub, dto);
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
  ) {
    await this.authService.setPassword(user.sub, dto);
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
  ) {
    const updated = await this.authService.changeEmail(user.sub, dto);
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
  ) {
    return successEnvelope(
      await this.accountService.unlinkIdentity(user.sub, identityId),
    );
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
  ) {
    await this.authService.linkWechatWebIdentity(user.sub, dto);
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
  ) {
    await this.authService.linkWechatMobileIdentity(user.sub, dto);
    return successEnvelope(await this.accountService.getAccount(user.sub));
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete authenticated account' })
  @ApiResponse({ status: 200, type: SuccessResponseDto })
  async deleteAccount(
    @CurrentUser() user: UserPayload,
    @Body() dto: DeleteAccountDto,
  ) {
    await this.authService.deleteAccount(user.sub, dto);
    return successEnvelope(null);
  }
}
