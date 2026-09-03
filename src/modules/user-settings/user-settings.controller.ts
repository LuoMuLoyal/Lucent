import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import type { UserPayload } from '../auth/index.js';
import { CurrentUser } from '../auth/index.js';
import { unwrapResult } from '../../common/result/index.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import { ProblemDetailsDto } from '../../common/index.js';
import { UserSettingsService } from './services/user-settings.service.js';
import { updateUserSettingsSchema } from './dto/update.dto.js';
import type { UpdateUserSettingsDto } from './dto/update.dto.js';

import { userSettingsDataSchema } from './dto/response.dto.js';

@ApiTags('User Settings')
@ApiBearerAuth('access-token')
@Controller('settings')
export class UserSettingsController {
  constructor(private readonly settingsService: UserSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get authenticated user settings' })
  @ApiResponse({
    status: 200,
    description: 'Authenticated user settings.',
  })
  @SerializeOptions({ schema: userSettingsDataSchema })
  async getSettings(@CurrentUser() user: UserPayload) {
    return await this.settingsService.getSettings(user.sub);
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update authenticated user settings' })
  @ApiResponse({
    status: 200,
    description: 'Updated user settings.',
  })
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
  @SerializeOptions({ schema: userSettingsDataSchema })
  async updateSettings(
    @CurrentUser() user: UserPayload,
    @Body({ schema: updateUserSettingsSchema }) dto: UpdateUserSettingsDto,
  ) {
    return await unwrapResult(
      this.settingsService.updateSettings(user.sub, dto),
    );
  }
}

registerResponseSchema({
  path: '/api/v1/user/settings',
  method: 'get',
  componentName: 'UserSettingsResponseDto',
  schema: userSettingsDataSchema,
  description: 'Authenticated user settings.',
});

registerResponseSchema({
  path: '/api/v1/user/settings',
  method: 'patch',
  componentName: 'UserSettingsResponseDto',
  schema: userSettingsDataSchema,
  description: 'Updated user settings.',
});
