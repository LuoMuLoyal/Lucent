import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { I18nLang, I18nService } from 'nestjs-i18n';

import { clampPage, clampPageSize } from '../../common';
import type { UserPayload } from '../auth';
import { CurrentUser } from '../auth';
import { NotificationsService } from './services/notifications.service';
import {
  NotificationListResponseDto,
  NotificationDetailResponseDto,
  UnreadCountResponseDto,
  CreateNotificationDto,
} from './dto/response.dto';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly i18n: I18nService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a notification (internal/test)' })
  @ApiResponse({ status: 201, type: NotificationListResponseDto })
  async create(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateNotificationDto,
  ) {
    return await this.notificationsService.create(user.sub, dto);
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
      page: clampPage(page),
      pageSize: clampPageSize(pageSize),
    });
    return { items, total };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  @ApiResponse({ status: 200, type: UnreadCountResponseDto })
  async getUnreadCount(@CurrentUser() user: UserPayload) {
    const count = await this.notificationsService.getUnreadCount(user.sub);
    return { count };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a notification detail' })
  @ApiResponse({ status: 200, type: NotificationDetailResponseDto })
  async findOne(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @I18nLang() lang: string,
  ) {
    const data = await this.notificationsService.findOne(user.sub, id);
    if (!data)
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: this.i18n.t('notifications.not_found', { lang }),
      });
    return data;
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiResponse({ status: 200, type: NotificationDetailResponseDto })
  async markAsRead(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @I18nLang() lang: string,
  ) {
    const data = await this.notificationsService.markAsRead(user.sub, id);
    if (!data)
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: this.i18n.t('notifications.not_found', { lang }),
      });
    return data;
  }

  @Patch(':id/unread')
  @ApiOperation({ summary: 'Mark a notification as unread' })
  @ApiResponse({ status: 200, type: NotificationDetailResponseDto })
  async markAsUnread(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @I18nLang() lang: string,
  ) {
    const data = await this.notificationsService.markAsUnread(user.sub, id);
    if (!data)
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: this.i18n.t('notifications.not_found', { lang }),
      });
    return data;
  }

  @Patch('mark-all-read')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({ status: 200, type: UnreadCountResponseDto })
  async markAllAsRead(@CurrentUser() user: UserPayload) {
    const count = await this.notificationsService.markAllAsRead(user.sub);
    return { count };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a notification' })
  async remove(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @I18nLang() lang: string,
  ) {
    const deleted = await this.notificationsService.remove(user.sub, id);
    if (!deleted)
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: this.i18n.t('notifications.not_found', { lang }),
      });
  }
}
