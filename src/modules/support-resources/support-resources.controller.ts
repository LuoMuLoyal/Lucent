import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { successEnvelope } from '../../common';
import { Public } from '../auth';
import {
  AppInfoResponseDto,
  SupportResourceListResponseDto,
} from './dto/response.dto';

import { SupportResourcesQueryDto } from './dto/query.dto';
import { SupportResourcesService } from './services/resources.service';

@ApiTags('Support Resources')
@Public()
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
