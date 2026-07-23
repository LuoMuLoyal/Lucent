import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { successEnvelope } from '../../common/api';
import { Public } from '../auth/decorators';
import { TestingSharedSecretGuard } from './guards/testing-shared-secret.guard';
import { TestingSupportService } from './services';
import { PrepareFullstackRecordLaneDto } from './dto';

@ApiExcludeController()
@Public()
@UseGuards(TestingSharedSecretGuard)
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
