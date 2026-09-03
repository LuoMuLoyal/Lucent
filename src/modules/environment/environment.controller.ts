import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/index.js';
import { environmentSnapshotQuerySchema } from './dto/snapshot-query.dto.js';
import type { EnvironmentSnapshotQueryDto } from './dto/snapshot-query.dto.js';

import { EnvironmentSnapshotResponseDto } from './dto/snapshot.dto.js';
import { EnvironmentService } from './services/snapshot.service.js';

@ApiTags('Environment')
@Public()
@Controller('environment')
export class EnvironmentController {
  constructor(private readonly environmentService: EnvironmentService) {}

  @Get('snapshot')
  @ApiOperation({
    summary: 'Get static environment snapshot reference data',
  })
  @ApiResponse({ status: 200, type: EnvironmentSnapshotResponseDto })
  getSnapshot(
    @Query({ schema: environmentSnapshotQuerySchema })
    query: EnvironmentSnapshotQueryDto,
  ) {
    return this.environmentService.getSnapshot(query);
  }
}
