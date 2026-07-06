import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { successEnvelope } from '../../common/api';
import {
  AppInfoResponseDto,
  SupportResourceListResponseDto,
  SupportResourcesQueryDto,
} from './dto';
import { SupportResourcesService } from './services/support-resources.service';

@ApiTags('Support Resources')
@Controller('public')
export class SupportResourcesController {
  constructor(private readonly service: SupportResourcesService) {}

  @Get('support-resources')
  @ApiOperation({ summary: 'Get static support resource entries' })
  @ApiResponse({ status: 200, type: SupportResourceListResponseDto })
  getResources(@Query() query: SupportResourcesQueryDto) {
    return successEnvelope(this.service.getResources(query));
  }

  @Get('app-info')
  @ApiOperation({ summary: 'Get application metadata' })
  @ApiResponse({ status: 200, type: AppInfoResponseDto })
  getAppInfo() {
    return successEnvelope(this.service.getAppInfo());
  }
}
