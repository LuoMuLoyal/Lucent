import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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

import { successEnvelope } from '../../common/api';
import { type UserPayload } from '../auth/services/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserSettingsService } from './services/user-settings.service';
import { UpdateUserSettingsDto, UserSettingsResponseDto } from './dto';
import { SecurityPinService } from '../security-pin/services';
import {
  ChangeSecurityPinDto,
  DisableSecurityPinDto,
  EnableSecurityPinDto,
  SecurityPinElevationResponseDto,
  VerifySecurityPinDto,
} from '../security-pin/dto/pin.dto';

@ApiTags('User Settings')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
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
    return successEnvelope(await this.settingsService.getSettings(user.sub));
  }

  @Patch()
  @ApiOperation({ summary: 'Update authenticated user settings' })
  @ApiResponse({ status: 200, type: UserSettingsResponseDto })
  async updateSettings(
    @CurrentUser() user: UserPayload,
    @Body() dto: UpdateUserSettingsDto,
  ) {
    return successEnvelope(
      await this.settingsService.updateSettings(user.sub, dto),
    );
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
    return successEnvelope(await this.settingsService.getSettings(user.sub));
  }

  @Post('security-pin/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify Security PIN and receive elevation token' })
  @ApiResponse({ status: 200, type: SecurityPinElevationResponseDto })
  async verifySecurityPin(
    @CurrentUser() user: UserPayload,
    @Body() dto: VerifySecurityPinDto,
  ) {
    return successEnvelope(await this.securityPinService.verify(user.sub, dto));
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
    return successEnvelope(await this.settingsService.getSettings(user.sub));
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
    return successEnvelope(await this.settingsService.getSettings(user.sub));
  }
}
