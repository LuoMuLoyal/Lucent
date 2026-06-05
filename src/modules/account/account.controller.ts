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
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { successEnvelope } from '../../common/api-envelope';
import { AuthService, type UserPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChangeEmailDto } from '../auth/dto/change-email.dto';
import { ChangePasswordDto } from '../auth/dto/change-password.dto';
import { DeleteAccountDto } from '../auth/dto/delete-account.dto';
import { SuccessResponseDto } from '../auth/dto/responses';
import { AccountService } from './account.service';
import {
  AccountEmailResponseDto,
  AccountResponseDto,
} from './dto/account-response.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@ApiTags('Account')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
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

  @Post('email')
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
