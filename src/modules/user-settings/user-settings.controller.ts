import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import type { UserPayload } from '../auth';
import { CurrentUser } from '../auth';
import { UserSettingsService } from './services/user-settings.service';
import { UpdateUserSettingsDto } from './dto/update.dto';

import { UserSettingsResponseDto } from './dto/response.dto';
import { SecurityPinService } from '../security-pin';
import {
  ChangeSecurityPinDto,
  DisableSecurityPinDto,
  EnableSecurityPinDto,
  SecurityPinElevationResponseDto,
  VerifySecurityPinDto,
} from '../security-pin';

@ApiTags('User Settings')
@ApiBearerAuth('access-token')
@Controller('settings')
export class UserSettingsController {
  constructor(
    private readonly settingsService: UserSettingsService,
    private readonly securityPinService: SecurityPinService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get authenticated user settings' })
  @ApiResponse({ status: 200, type: UserSettingsResponseDto })
  async getSettings(@CurrentUser() user: UserPayload) {
    return await this.settingsService.getSettings(user.sub);
  }

  @Patch()
  @ApiOperation({ summary: 'Update authenticated user settings' })
  @ApiResponse({ status: 200, type: UserSettingsResponseDto })
  async updateSettings(
    @CurrentUser() user: UserPayload,
    @Body() dto: UpdateUserSettingsDto,
  ) {
    return await this.settingsService.updateSettings(user.sub, dto);
  }

  @Post('security-pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enable Security PIN' })
  @ApiResponse({ status: 200, type: UserSettingsResponseDto })
  async enableSecurityPin(
    @CurrentUser() user: UserPayload,
    @Body() dto: EnableSecurityPinDto,
  ) {
    await this.securityPinService.enable(user.sub, dto);
    await this.settingsService.invalidateUserCache(user.sub);
    return await this.settingsService.getSettings(user.sub);
  }

  @Post('security-pin/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify Security PIN and receive elevation token' })
  @ApiResponse({ status: 200, type: SecurityPinElevationResponseDto })
  async verifySecurityPin(
    @CurrentUser() user: UserPayload,
    @Body() dto: VerifySecurityPinDto,
  ) {
    return await this.securityPinService.verify(user.sub, dto);
  }

  @Post('security-pin/change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change Security PIN' })
  @ApiResponse({ status: 200, type: UserSettingsResponseDto })
  async changeSecurityPin(
    @CurrentUser() user: UserPayload,
    @Body() dto: ChangeSecurityPinDto,
  ) {
    await this.securityPinService.change(user.sub, dto);
    await this.settingsService.invalidateUserCache(user.sub);
    return await this.settingsService.getSettings(user.sub);
  }

  @Post('security-pin/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable Security PIN' })
  @ApiResponse({ status: 200, type: UserSettingsResponseDto })
  async disableSecurityPin(
    @CurrentUser() user: UserPayload,
    @Body() dto: DisableSecurityPinDto,
  ) {
    await this.securityPinService.disable(user.sub, dto);
    await this.settingsService.invalidateUserCache(user.sub);
    return await this.settingsService.getSettings(user.sub);
  }
}
