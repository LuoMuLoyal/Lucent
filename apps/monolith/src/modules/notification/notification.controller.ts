import { Body, Controller, Get, Patch, SerializeOptions } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { UserPayload } from '../auth/index.js';
import { CurrentUser } from '../auth/index.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import { ProblemDetailsDto } from '../../common/index.js';
import { unwrapResult } from '../../common/result/index.js';
import { updateNotificationPreferencesSchema } from './dto/update.dto.js';
import type { UpdateNotificationPreferencesDto } from './dto/update.dto.js';
import { notificationPreferencesSchema } from './dto/response.dto.js';
import { NotificationService } from './services/notification.service.js';

@ApiTags('Notification Preferences')
@ApiBearerAuth('access-token')
@Controller('notification')
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Get()
  @ApiOperation({
    operationId: 'getNotificationPreferences',
    summary: 'Get authenticated user notification preferences',
  })
  @ApiResponse({
    status: 200,
    description: 'Authenticated user notification preferences.',
  })
  @SerializeOptions({ schema: notificationPreferencesSchema })
  async get(@CurrentUser() user: UserPayload) {
    return await this.service.get(user.sub);
  }

  @Patch()
  @ApiOperation({
    operationId: 'patch',
    summary: 'Patch authenticated user notification preferences',
  })
  @ApiResponse({
    status: 200,
    description: 'Updated notification preferences.',
  })
  @ApiResponse({
    status: 400,
    description: 'Sleep time minutes out of range 0-1439 (VALIDATION_FAILED)',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: notificationPreferencesSchema })
  async patch(
    @CurrentUser() user: UserPayload,
    @Body({ schema: updateNotificationPreferencesSchema })
    dto: UpdateNotificationPreferencesDto,
  ) {
    return await unwrapResult(this.service.patch(user.sub, dto));
  }
}

registerResponseSchema({
  path: '/api/v1/user/notification',
  method: 'get',
  componentName: 'NotificationPreferencesResponse',
  schema: notificationPreferencesSchema,
  description: 'Authenticated user notification preferences.',
});

registerResponseSchema({
  path: '/api/v1/user/notification',
  method: 'patch',
  componentName: 'NotificationPreferencesResponse',
  schema: notificationPreferencesSchema,
  description: 'Updated notification preferences.',
});
