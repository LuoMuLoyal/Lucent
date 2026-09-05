import { Controller, Get, SerializeOptions } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/index.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import { appInfoResponseSchema } from './dto/response.dto.js';
import { AppInfoService } from './services/info.service.js';

@ApiTags('App Info')
@Public()
@Controller('public')
export class AppInfoController {
  constructor(private readonly service: AppInfoService) {}

  @Get('app-info')
  @ApiOperation({ summary: 'Get application metadata' })
  @ApiResponse({ status: 200, description: 'Application metadata.' })
  @SerializeOptions({ schema: appInfoResponseSchema })
  getAppInfo() {
    return this.service.getAppInfo();
  }
}

registerResponseSchema({
  path: '/api/v1/public/app-info',
  method: 'get',
  componentName: 'AppInfoResponse',
  schema: appInfoResponseSchema,
  description: 'Application metadata.',
});
