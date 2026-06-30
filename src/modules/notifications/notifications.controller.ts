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
  UseGuards,
} from '@nestjs/common';
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
import { NotificationsService } from './services/notifications.service';
import {
  NotificationListResponseDto,
  NotificationDetailResponseDto,
  UnreadCountResponseDto,
  CreateNotificationDto,
} from './dto';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('user/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a notification (internal/test)' })
  @ApiResponse({ status: 201, type: NotificationListResponseDto })
  async create(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateNotificationDto,
  ) {
    return successEnvelope(
      await this.notificationsService.create(user.sub, dto),
    );
  }

  @Get()
  @ApiOperation({ summary: 'List user notifications' })
  @ApiResponse({ status: 200, type: NotificationListResponseDto })
  async findAll(
    @CurrentUser() user: UserPayload,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('pageSize', new ParseIntPipe({ optional: true }))
    pageSize: number = 20,
  ) {
    const { items, total } = await this.notificationsService.findAll(user.sub, {
      page,
      pageSize,
    });
    return successEnvelope({ items, total });
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  @ApiResponse({ status: 200, type: UnreadCountResponseDto })
  async getUnreadCount(@CurrentUser() user: UserPayload) {
    const count = await this.notificationsService.getUnreadCount(user.sub);
    return successEnvelope({ count });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a notification detail' })
  @ApiResponse({ status: 200, type: NotificationDetailResponseDto })
  async findOne(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    const data = await this.notificationsService.findOne(user.sub, id);
    return successEnvelope(data);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiResponse({ status: 200, type: NotificationDetailResponseDto })
  async markAsRead(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    const data = await this.notificationsService.markAsRead(user.sub, id);
    return successEnvelope(data);
  }

  @Patch(':id/unread')
  @ApiOperation({ summary: 'Mark a notification as unread' })
  @ApiResponse({ status: 200, type: NotificationDetailResponseDto })
  async markAsUnread(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
  ) {
    const data = await this.notificationsService.markAsUnread(user.sub, id);
    return successEnvelope(data);
  }

  @Patch('mark-all-read')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({ status: 200, type: UnreadCountResponseDto })
  async markAllAsRead(@CurrentUser() user: UserPayload) {
    const count = await this.notificationsService.markAllAsRead(user.sub);
    return successEnvelope({ count });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a notification' })
  async remove(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    await this.notificationsService.remove(user.sub, id);
  }
}
