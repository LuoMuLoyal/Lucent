import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth';
import { AppInfoResponseDto } from './dto/response.dto';
import { AppInfoService } from './services/info.service';

@ApiTags('App Info')
@Public()
@Controller('public')
export class AppInfoController {
  constructor(private readonly service: AppInfoService) {}

  @Get('app-info')
  @ApiOperation({ summary: 'Get application metadata' })
  @ApiResponse({ status: 200, type: AppInfoResponseDto })
  getAppInfo() {
    return this.service.getAppInfo();
  }
}
