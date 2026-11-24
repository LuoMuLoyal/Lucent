import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/index.js';
import { TestingController } from './adapters/http/testing.controller.js';
import { TestingSharedSecretGuard } from './adapters/http/guards/testing-shared-secret.guard.js';
import { TestingService } from './infrastructure/fixtures/record-lane.js';
import { RECORD_LANE_FIXTURE } from './application/ports/fixtures.js';

@Module({
  imports: [PrismaModule],
  controllers: [TestingController],
  providers: [
    TestingSharedSecretGuard,
    TestingService,
    { provide: RECORD_LANE_FIXTURE, useExisting: TestingService },
  ],
})
export class TestingModule {}
