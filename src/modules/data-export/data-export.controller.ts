import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
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
import { DataExportService } from './data-export.service';
import {
  DataExportLatestResponseDto,
  DataExportRequestResponseDto,
} from './dto';

@ApiTags('Data Export')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('me/data-export-requests')
export class DataExportController {
  constructor(private readonly exportService: DataExportService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new data export request' })
  @ApiResponse({ status: 201, type: DataExportRequestResponseDto })
  async createRequest(@CurrentUser() user: UserPayload) {
    return successEnvelope(await this.exportService.createRequest(user.sub));
  }

  @Get('latest')
  @ApiOperation({ summary: 'Get the latest data export request' })
  @ApiResponse({ status: 200, type: DataExportLatestResponseDto })
  async getLatestRequest(@CurrentUser() user: UserPayload) {
    return successEnvelope(await this.exportService.getLatestRequest(user.sub));
  }
}
