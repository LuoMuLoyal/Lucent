import { Controller, Get, Query, SerializeOptions } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/index.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import { environmentSnapshotQuerySchema } from './dto/snapshot-query.dto.js';
import type { EnvironmentSnapshotQueryDto } from './dto/snapshot-query.dto.js';

import { environmentSnapshotResponseSchema } from './dto/snapshot.dto.js';
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
  @ApiResponse({
    status: 200,
    description: 'Static environment snapshot reference data.',
  })
  @SerializeOptions({ schema: environmentSnapshotResponseSchema })
  getSnapshot(
    @Query({ schema: environmentSnapshotQuerySchema })
    query: EnvironmentSnapshotQueryDto,
  ) {
    return this.environmentService.getSnapshot(query);
  }
}

registerResponseSchema({
  path: '/api/v1/environment/snapshot',
  method: 'get',
  componentName: 'EnvironmentSnapshotResponseDto',
  schema: environmentSnapshotResponseSchema,
  description: 'Static environment snapshot reference data.',
});
