import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/index.js';
import { TestingSupportController } from './adapters/http/testing-support.controller.js';
import { TestingSharedSecretGuard } from './adapters/http/guards/testing-shared-secret.guard.js';
import { TestingSupportService } from './infrastructure/fixtures/record-lane.js';
import { RECORD_LANE_FIXTURE } from './application/ports/fixtures.js';

@Module({
  imports: [PrismaModule],
  controllers: [TestingSupportController],
  providers: [
    TestingSharedSecretGuard,
    TestingSupportService,
    { provide: RECORD_LANE_FIXTURE, useExisting: TestingSupportService },
  ],
})
export class TestingSupportModule {}
