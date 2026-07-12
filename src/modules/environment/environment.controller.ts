import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { successEnvelope } from '../../common/api';
import {
  EnvironmentSnapshotQueryDto,
  EnvironmentSnapshotResponseDto,
} from './dto';
import { EnvironmentService } from './services/snapshot.service';

@ApiTags('Environment')
@Controller('environment')
export class EnvironmentController {
  constructor(private readonly environmentService: EnvironmentService) {}

  @Get('snapshot')
  @ApiOperation({
    summary: 'Get static environment snapshot reference data',
  })
  @ApiQuery({
    name: 'lat',
    required: false,
    type: Number,
    minimum: -90,
    maximum: 90,
    description: 'Approximate latitude.',
  })
  @ApiQuery({
    name: 'lon',
    required: false,
    type: Number,
    minimum: -180,
    maximum: 180,
    description: 'Approximate longitude.',
  })
  @ApiResponse({ status: 200, type: EnvironmentSnapshotResponseDto })
  getSnapshot(@Query() query: EnvironmentSnapshotQueryDto) {
    return successEnvelope(this.environmentService.getSnapshot(query));
  }
}
