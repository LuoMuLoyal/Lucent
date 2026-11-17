import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { Public } from '../../../auth/index.js';
import { TestingSharedSecretGuard } from './guards/testing-shared-secret.guard.js';
import {
  RECORD_LANE_FIXTURE,
  type RecordLaneFixturePort,
} from '../../application/ports/fixtures.js';
import { prepareFullstackRecordLaneSchema } from './dto/prepare-fullstack-record-lane.dto.js';
import type { PrepareFullstackRecordLaneDto } from './dto/prepare-fullstack-record-lane.dto.js';

@ApiExcludeController()
@Public()
@UseGuards(TestingSharedSecretGuard)
@Controller('testing/fullstack-e2e')
export class TestingSupportController {
  constructor(
    @Inject(RECORD_LANE_FIXTURE)
    private readonly testingSupportService: RecordLaneFixturePort,
  ) {}

  @Post('record-lane/prepare')
  @HttpCode(HttpStatus.OK)
  async prepareFullstackRecordLane(
    @Body({ schema: prepareFullstackRecordLaneSchema })
    dto: PrepareFullstackRecordLaneDto,
  ) {
    return await this.testingSupportService.prepareFullstackRecordLane(dto);
  }
}
