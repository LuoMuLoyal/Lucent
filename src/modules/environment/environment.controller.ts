import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth';
import { EnvironmentSnapshotQueryDto } from './dto/snapshot-query.dto';

import { EnvironmentSnapshotResponseDto } from './dto/snapshot.dto';
import { EnvironmentService } from './services/snapshot.service';

@ApiTags('Environment')
@Public()
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
    return this.environmentService.getSnapshot(query);
  }
}
