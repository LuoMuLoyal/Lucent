import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { successEnvelope } from '../../common';
import type { UserPayload } from '../auth';
import { CurrentUser } from '../auth';
import { UpdateNotificationPreferencesDto } from './dto/update.dto';
import { NotificationPreferencesResponseDto } from './dto/response.dto';
import { NotificationPreferencesService } from './services/notification-preferences.service';

@ApiTags('Notification Preferences')
@ApiBearerAuth('access-token')
@Controller('notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly service: NotificationPreferencesService) {}

  @Get()
  @ApiOperation({ summary: 'Get authenticated user notification preferences' })
  @ApiResponse({ status: 200, type: NotificationPreferencesResponseDto })
  async get(@CurrentUser() user: UserPayload) {
    return successEnvelope(await this.service.get(user.sub));
  }

  @Patch()
  @ApiOperation({
    summary: 'Patch authenticated user notification preferences',
  })
  @ApiResponse({ status: 200, type: NotificationPreferencesResponseDto })
  async patch(
    @CurrentUser() user: UserPayload,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return successEnvelope(await this.service.patch(user.sub, dto));
  }
}
