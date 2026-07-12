import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { successEnvelope } from '../../common/api';
import { TestingSupportService } from './services/fixtures.service';
import { PrepareFullstackRecordLaneDto } from './dto/prepare-fullstack-record-lane.dto';

@ApiExcludeController()
@Controller('testing/fullstack-e2e')
export class TestingSupportController {
  constructor(private readonly testingSupportService: TestingSupportService) {}

  @Post('record-lane/prepare')
  @HttpCode(HttpStatus.OK)
  async prepareFullstackRecordLane(@Body() dto: PrepareFullstackRecordLaneDto) {
    return successEnvelope(
      await this.testingSupportService.prepareFullstackRecordLane(dto),
    );
  }
}
