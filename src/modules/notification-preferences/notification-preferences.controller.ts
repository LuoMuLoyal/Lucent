import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { UserPayload } from '../auth/index.js';
import { CurrentUser } from '../auth/index.js';
import { ProblemDetailsDto } from '../../common/index.js';
import { unwrapResult } from '../../common/result/index.js';
import { UpdateNotificationPreferencesDto } from './dto/update.dto.js';
import { NotificationPreferencesResponseDto } from './dto/response.dto.js';
import { NotificationPreferencesService } from './services/notification-preferences.service.js';

@ApiTags('Notification Preferences')
@ApiBearerAuth('access-token')
@Controller('notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly service: NotificationPreferencesService) {}

  @Get()
  @ApiOperation({ summary: 'Get authenticated user notification preferences' })
  @ApiResponse({ status: 200, type: NotificationPreferencesResponseDto })
  async get(@CurrentUser() user: UserPayload) {
    return await this.service.get(user.sub);
  }

  @Patch()
  @ApiOperation({
    summary: 'Patch authenticated user notification preferences',
  })
  @ApiResponse({ status: 200, type: NotificationPreferencesResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Sleep time minutes out of range 0-1439 (VALIDATION_FAILED)',
    type: ProblemDetailsDto,
  })
  async patch(
    @CurrentUser() user: UserPayload,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return await unwrapResult(this.service.patch(user.sub, dto));
  }
}
