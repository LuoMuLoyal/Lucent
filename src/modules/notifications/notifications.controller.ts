import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import {
  clampPage,
  clampPageSize,
  ProblemDetailsDto,
} from '../../common/index.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import { unwrapResult } from '../../common/result/index.js';
import type { UserPayload } from '../auth/index.js';
import { CurrentUser } from '../auth/index.js';
import { NotificationsService } from './services/notifications.service.js';
import {
  createNotificationSchema,
  notificationDetailSchema,
  notificationListItemSchema,
  notificationListSchema,
  unreadCountSchema,
} from './dto/response.dto.js';
import type { CreateNotificationDto } from './dto/response.dto.js';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a notification (internal/test)' })
  @ApiResponse({
    status: 201,
    description: 'Created notification.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Notification already exists (RESOURCE_CONFLICT, P2002 race)',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: notificationListItemSchema })
  async create(
    @CurrentUser() user: UserPayload,
    @Body({ schema: createNotificationSchema }) dto: CreateNotificationDto,
  ) {
    return await unwrapResult(this.notificationsService.create(user.sub, dto));
  }

  @Get()
  @ApiOperation({ summary: 'List user notifications' })
  @ApiResponse({ status: 200, description: 'Paginated notification list.' })
  @SerializeOptions({ schema: notificationListSchema })
  async findAll(
    @CurrentUser() user: UserPayload,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('pageSize', new ParseIntPipe({ optional: true }))
    pageSize: number = 20,
  ) {
    const { items, total } = await this.notificationsService.findAll(user.sub, {
      page: clampPage(page),
      pageSize: clampPageSize(pageSize),
    });
    return { items, total };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  @ApiResponse({ status: 200, description: 'Unread notification count.' })
  @SerializeOptions({ schema: unreadCountSchema })
  async getUnreadCount(@CurrentUser() user: UserPayload) {
    const count = await this.notificationsService.getUnreadCount(user.sub);
    return { count };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a notification detail' })
  @ApiResponse({ status: 200, description: 'Notification detail.' })
  @ApiResponse({
    status: 404,
    type: ProblemDetailsDto,
    description: 'Notification not found.',
  })
  @SerializeOptions({ schema: notificationDetailSchema })
  async findOne(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    return await unwrapResult(this.notificationsService.findOne(user.sub, id));
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiResponse({ status: 200, description: 'Notification marked as read.' })
  @ApiResponse({
    status: 404,
    type: ProblemDetailsDto,
    description: 'Notification not found.',
  })
  @SerializeOptions({ schema: notificationDetailSchema })
  async markAsRead(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    return await unwrapResult(
      this.notificationsService.markAsRead(user.sub, id),
    );
  }

  @Patch(':id/unread')
  @ApiOperation({ summary: 'Mark a notification as unread' })
  @ApiResponse({ status: 200, description: 'Notification marked as unread.' })
  @ApiResponse({
    status: 404,
    type: ProblemDetailsDto,
    description: 'Notification not found.',
  })
  @SerializeOptions({ schema: notificationDetailSchema })
  async markAsUnread(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
  ) {
    return await unwrapResult(
      this.notificationsService.markAsUnread(user.sub, id),
    );
  }

  @Patch('mark-all-read')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({
    status: 200,
    description: 'Number of notifications marked as read.',
  })
  @SerializeOptions({ schema: unreadCountSchema })
  async markAllAsRead(@CurrentUser() user: UserPayload) {
    const count = await this.notificationsService.markAllAsRead(user.sub);
    return { count };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a notification' })
  @ApiResponse({
    status: 204,
    description: 'Notification deleted.',
  })
  @ApiResponse({
    status: 404,
    type: ProblemDetailsDto,
    description: 'Notification not found.',
  })
  async remove(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    await unwrapResult(this.notificationsService.remove(user.sub, id));
  }
}

registerResponseSchema({
  path: '/api/v1/user/notifications',
  method: 'get',
  componentName: 'NotificationListResponseDto',
  schema: notificationListSchema,
  description: 'Paginated notification list.',
});

registerResponseSchema({
  path: '/api/v1/user/notifications/unread-count',
  method: 'get',
  componentName: 'UnreadCountResponseDto',
  schema: unreadCountSchema,
  description: 'Unread notification count.',
});

registerResponseSchema({
  path: '/api/v1/user/notifications/{id}',
  method: 'get',
  componentName: 'NotificationDetailResponseDto',
  schema: notificationDetailSchema,
  description: 'Notification detail.',
});

registerResponseSchema({
  path: '/api/v1/user/notifications/{id}/read',
  method: 'patch',
  componentName: 'NotificationDetailResponseDto',
  schema: notificationDetailSchema,
  description: 'Notification marked as read.',
});

registerResponseSchema({
  path: '/api/v1/user/notifications/{id}/unread',
  method: 'patch',
  componentName: 'NotificationDetailResponseDto',
  schema: notificationDetailSchema,
  description: 'Notification marked as unread.',
});

registerResponseSchema({
  path: '/api/v1/user/notifications/mark-all-read',
  method: 'patch',
  componentName: 'UnreadCountResponseDto',
  schema: unreadCountSchema,
  description: 'Number of notifications marked as read.',
});
