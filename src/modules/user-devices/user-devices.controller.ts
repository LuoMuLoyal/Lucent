import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';

import { successEnvelope } from '../../common';
import type { UserPayload } from '../auth';
import { CurrentUser } from '../auth';
import { UserDevicesService } from './services/user-devices.service';
import {
  DeviceListResponseDto,
  DeviceResponseDto,
} from './dto/device-response.dto';

import { RegisterDeviceDto } from './dto/register-device.dto';

@ApiTags('User Devices')
@ApiBearerAuth('access-token')
@Controller('user-devices')
export class UserDevicesController {
  constructor(private readonly userDevicesService: UserDevicesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register or update a device for push notifications',
  })
  @ApiResponse({ status: 201, type: DeviceResponseDto })
  async register(
    @CurrentUser() user: UserPayload,
    @Body() dto: RegisterDeviceDto,
    @I18nLang() lang: string,
  ) {
    return successEnvelope(
      await this.userDevicesService.register(user.sub, dto, lang),
    );
  }

  @Get()
  @ApiOperation({ summary: 'List registered devices' })
  @ApiResponse({ status: 200, type: DeviceListResponseDto })
  async list(@CurrentUser() user: UserPayload) {
    return successEnvelope(await this.userDevicesService.list(user.sub));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unregister a device' })
  async remove(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @I18nLang() lang: string,
  ) {
    await this.userDevicesService.remove(user.sub, id, lang);
  }
}
