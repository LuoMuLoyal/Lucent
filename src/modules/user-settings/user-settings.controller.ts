import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import type { UserPayload } from '../auth';
import { CurrentUser } from '../auth';
import { unwrapResult } from '../../common/result';
import { ProblemDetailsDto } from '../../common';
import { UserSettingsService } from './services/user-settings.service';
import { UpdateUserSettingsDto } from './dto/update.dto';

import { UserSettingsResponseDto } from './dto/response.dto';

@ApiTags('User Settings')
@ApiBearerAuth('access-token')
@Controller('settings')
export class UserSettingsController {
  constructor(private readonly settingsService: UserSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get authenticated user settings' })
  @ApiResponse({ status: 200, type: UserSettingsResponseDto })
  async getSettings(@CurrentUser() user: UserPayload) {
    return await this.settingsService.getSettings(user.sub);
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update authenticated user settings' })
  @ApiResponse({ status: 200, type: UserSettingsResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Validation failed (VALIDATION_FAILED)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Settings upsert conflict (RESOURCE_CONFLICT, race)',
    type: ProblemDetailsDto,
  })
  async updateSettings(
    @CurrentUser() user: UserPayload,
    @Body() dto: UpdateUserSettingsDto,
  ) {
    return await unwrapResult(
      this.settingsService.updateSettings(user.sub, dto),
    );
  }
}
