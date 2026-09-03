import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { Public } from '../auth/index.js';
import { TestingSharedSecretGuard } from './guards/testing-shared-secret.guard.js';
import { TestingSupportService } from './services/fixtures.service.js';
import { PrepareFullstackRecordLaneDto } from './dto/prepare-fullstack-record-lane.dto.js';

@ApiExcludeController()
@Public()
@UseGuards(TestingSharedSecretGuard)
@Controller('testing/fullstack-e2e')
export class TestingSupportController {
  constructor(private readonly testingSupportService: TestingSupportService) {}

  @Post('record-lane/prepare')
  @HttpCode(HttpStatus.OK)
  async prepareFullstackRecordLane(@Body() dto: PrepareFullstackRecordLaneDto) {
    return await this.testingSupportService.prepareFullstackRecordLane(dto);
  }
}
