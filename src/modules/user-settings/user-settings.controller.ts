import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { successEnvelope } from '../../common/api-envelope';
import { type UserPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserSettingsService } from './user-settings.service';
import { UpdateUserSettingsDto, UserSettingsResponseDto } from './dto';

@ApiTags('User Settings')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('user/settings')
export class UserSettingsController {
  constructor(private readonly settingsService: UserSettingsService) {}

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
}
