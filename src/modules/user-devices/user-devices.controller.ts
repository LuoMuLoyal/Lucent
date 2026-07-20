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

import { successEnvelope } from '../../common/api';
import type { UserPayload } from '../auth/services/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDevicesService } from './services';
import {
  DeviceListResponseDto,
  DeviceResponseDto,
  RegisterDeviceDto,
} from './dto';

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
  ) {
    return successEnvelope(
      await this.userDevicesService.register(user.sub, dto),
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
  async remove(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    await this.userDevicesService.remove(user.sub, id);
  }
}
